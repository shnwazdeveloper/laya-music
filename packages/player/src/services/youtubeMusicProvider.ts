import { invoke } from '@tauri-apps/api/core';

import type {
  Album,
  AlbumRef,
  ArtistRef,
  ArtworkSet,
  Playlist,
  Stream,
  StreamCandidate,
  Track,
  TrackRef,
} from '@nuclearplayer/model';
import type {
  DashboardProvider,
  MetadataProvider,
  PlaylistProvider,
  StreamingProvider,
} from '@nuclearplayer/plugin-sdk';

import { useStartupStore } from '../stores/startupStore';
import { providersHost } from './providersHost';
import { ytdlpEnsureInstalled } from './tauri/commands';
import { ytdlpHost } from './ytdlpHost';

const METADATA_PROVIDER_ID = 'youtube-music-metadata';
const STREAMING_PROVIDER_ID = 'youtube-music-streaming';
const DASHBOARD_PROVIDER_ID = 'youtube-music-dashboard';
const PLAYLIST_PROVIDER_ID = 'youtube-music-playlists';

type YtMusicThumbnail = {
  url: string;
  width: number | null;
  height: number | null;
};

type YtMusicSearchResult = {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  duration_ms: number | null;
  thumbnail: YtMusicThumbnail | null;
  url: string;
};

type CandidateSource = {
  id: string;
  title: string;
  durationMs?: number;
  thumbnail?: string | null;
  url?: string;
};

let ytdlpReadyPromise: Promise<boolean> | null = null;

const ensureYtdlpReady = async (): Promise<void> => {
  if (!ytdlpReadyPromise) {
    ytdlpReadyPromise = ytdlpEnsureInstalled().catch((error) => {
      ytdlpReadyPromise = null;
      throw error;
    });
  }

  await ytdlpReadyPromise;
};

const ytmusicSearch = async (
  query: string,
  maxResults = 50,
): Promise<YtMusicSearchResult[]> =>
  invoke<YtMusicSearchResult[]>('ytmusic_search', {
    query,
    maxResults,
  });

const providerRef = (id: string, url?: string) => ({
  provider: METADATA_PROVIDER_ID,
  id,
  url,
});

const decodeIdPart = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const artistSourceId = (name: string) => `artist:${encodeURIComponent(name)}`;

const artistRefFromName = (name: string): ArtistRef => ({
  name,
  source: providerRef(artistSourceId(name)),
});

const artistCreditFromName = (name: string) => ({
  name,
  roles: ['main'],
  source: providerRef(artistSourceId(name)),
});

const artworkFromThumbnail = (
  thumbnail: YtMusicThumbnail | null,
): ArtworkSet | undefined =>
  thumbnail
    ? {
        items: [
          {
            url: thumbnail.url,
            width: thumbnail.width ?? undefined,
            height: thumbnail.height ?? undefined,
            purpose: 'cover',
            source: providerRef(thumbnail.url, thumbnail.url),
          },
        ],
      }
    : undefined;

const albumQueryFromResult = (result: YtMusicSearchResult): string =>
  [
    result.artists.length ? result.artists.join(' ') : undefined,
    result.album ?? result.title,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

const albumSourceIdFromResult = (result: YtMusicSearchResult): string =>
  `album:${encodeURIComponent(albumQueryFromResult(result) || result.id)}`;

const albumRefFromResult = (
  result: YtMusicSearchResult,
): AlbumRef | undefined => {
  if (!result.album) {
    return undefined;
  }

  const artists = result.artists.length ? result.artists : ['YouTube Music'];
  const artwork = artworkFromThumbnail(result.thumbnail);

  return {
    title: result.album,
    artists: artists.map(artistRefFromName),
    artwork,
    source: providerRef(albumSourceIdFromResult(result), result.url),
  };
};

const trackFromResult = (result: YtMusicSearchResult): Track => {
  const artwork = artworkFromThumbnail(result.thumbnail);
  const artists = result.artists.length ? result.artists : ['YouTube Music'];

  return {
    title: result.title,
    artists: artists.map(artistCreditFromName),
    album: albumRefFromResult(result),
    durationMs: result.duration_ms ?? undefined,
    artwork,
    source: providerRef(result.id, result.url),
    streamCandidates: [candidateFromResult(result)],
  };
};

const candidateFromResult = (result: YtMusicSearchResult): StreamCandidate => ({
  id: result.id,
  title: result.title,
  durationMs: result.duration_ms ?? undefined,
  thumbnail: result.thumbnail?.url,
  failed: false,
  source: {
    provider: STREAMING_PROVIDER_ID,
    id: result.id,
    url: result.url,
  },
});

const candidateFromTrack = (track: Track): StreamCandidate => ({
  id: track.source.id,
  title: track.title,
  durationMs: track.durationMs,
  thumbnail: track.artwork?.items[0]?.url,
  failed: false,
  source: {
    provider: STREAMING_PROVIDER_ID,
    id: track.source.id,
    url: track.source.url,
  },
});

const candidateFromSource = (source: CandidateSource): StreamCandidate => ({
  id: source.id,
  title: source.title,
  durationMs: source.durationMs,
  thumbnail: source.thumbnail ?? undefined,
  failed: false,
  source: {
    provider: STREAMING_PROVIDER_ID,
    id: source.id,
    url: source.url ?? `https://www.youtube.com/watch?v=${source.id}`,
  },
});

const uniqueCandidates = (candidates: StreamCandidate[]): StreamCandidate[] => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }
    seen.add(candidate.id);
    return true;
  });
};

const searchFallbackCandidates = async (
  query: string,
): Promise<StreamCandidate[]> => {
  const [ytMusicResults, youtubeResults] = await Promise.all([
    ytmusicSearch(query, 10).catch(() => []),
    ensureYtdlpReady()
      .then(() => ytdlpHost.search(query, 10))
      .catch(() => []),
  ]);

  return uniqueCandidates([
    ...ytMusicResults.map(candidateFromResult),
    ...youtubeResults.map((result) =>
      candidateFromSource({
        id: result.id,
        title: result.title,
        durationMs: result.duration ? Math.round(result.duration * 1000) : undefined,
        thumbnail: result.thumbnail,
      }),
    ),
  ]);
};

const streamFromVideoId = async (videoId: string): Promise<Stream> => {
  await ensureYtdlpReady();

  const stream = await ytdlpHost.getStream(videoId);
  const protocol = stream.stream_url.startsWith('https') ? 'https' : 'http';

  return {
    url: stream.stream_url,
    protocol,
    durationMs: stream.duration
      ? Math.round(stream.duration * 1000)
      : undefined,
    container: stream.container ?? undefined,
    codec: stream.codec ?? undefined,
    source: {
      provider: STREAMING_PROVIDER_ID,
      id: videoId,
      url: `https://music.youtube.com/watch?v=${videoId}`,
    },
  };
};

const searchTracks = async (
  query: string,
  limit?: number,
): Promise<Track[]> => {
  const results = await ytmusicSearch(query, limit ?? 50);
  return results.map(trackFromResult);
};

const albumsFromTracks = (tracks: Track[], limit?: number): AlbumRef[] => {
  const albums = tracks
    .map((track) => track.album)
    .filter((album): album is AlbumRef => Boolean(album));

  const seen = new Set<string>();
  return albums
    .filter((album) => {
      const key = `${album.title.toLowerCase()}::${album.artists
        ?.map((artist) => artist.name.toLowerCase())
        .join(',')}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit ?? 50);
};

const searchAlbums = async (
  query: string,
  limit?: number,
): Promise<AlbumRef[]> => {
  const tracks = await searchTracks(query, limit ?? 50);
  return albumsFromTracks(tracks, limit);
};

const albumQueryFromId = (albumId: string): string => {
  const decoded = decodeIdPart(albumId);
  const withoutPrefix = decoded.startsWith('album:')
    ? decoded.slice('album:'.length)
    : decoded;
  return decodeIdPart(withoutPrefix).trim() || 'top songs';
};

const trackRefFromTrack = (track: Track): TrackRef => ({
  title: track.title,
  artists: track.artists.map((artist) =>
    artistRefFromName(artist.name || 'YouTube Music'),
  ),
  artwork: track.artwork,
  source: track.source,
});

const fetchAlbumDetails = async (albumId: string): Promise<Album> => {
  const query = albumQueryFromId(albumId);
  let tracks = await searchTracks(query, 50);

  if (!tracks.length && query !== 'top songs') {
    tracks = await searchTracks('top songs', 50);
  }

  const firstAlbum = tracks.find((track) => track.album)?.album;
  const firstTrack = tracks[0];
  const artists =
    firstAlbum?.artists?.map((artist) => artistCreditFromName(artist.name)) ??
    firstTrack?.artists ??
    [artistCreditFromName('YouTube Music')];

  return {
    title: firstAlbum?.title ?? query,
    artists,
    tracks: tracks.map(trackRefFromTrack),
    artwork: firstAlbum?.artwork ?? firstTrack?.artwork,
    source: providerRef(albumId),
  };
};

const youtubeMusicMetadataProvider: MetadataProvider = {
  id: METADATA_PROVIDER_ID,
  name: 'YouTube Music',
  kind: 'metadata',
  searchCapabilities: ['unified', 'tracks', 'albums'],
  albumMetadataCapabilities: ['albumDetails'],
  streamingProviderId: STREAMING_PROVIDER_ID,
  search: async ({ query, limit }) => {
    const tracks = await searchTracks(query, limit ?? 50);
    return {
      albums: albumsFromTracks(tracks, limit),
      tracks,
    };
  },
  searchAlbums: async ({ query, limit }) => searchAlbums(query, limit),
  searchTracks: async ({ query, limit }) => searchTracks(query, limit),
  fetchAlbumDetails,
};

const youtubeMusicStreamingProvider: StreamingProvider = {
  id: STREAMING_PROVIDER_ID,
  name: 'YouTube Music',
  kind: 'streaming',
  searchForTrack: async (artist, title, album) => {
    const query = [artist, title, album].filter(Boolean).join(' ');
    return searchFallbackCandidates(query);
  },
  searchForTrackV2: async (track) => {
    const artist = track.artists[0]?.name;
    const query = [artist, track.title, track.album?.title]
      .filter(Boolean)
      .join(' ');

    if (track.source.provider === METADATA_PROVIDER_ID) {
      return uniqueCandidates([
        candidateFromTrack(track),
        ...(await searchFallbackCandidates(query)),
      ]);
    }

    return searchFallbackCandidates(query);
  },
  getStreamUrl: streamFromVideoId,
  getStreamUrlV2: (candidate) => streamFromVideoId(candidate.id),
};

const youtubeMusicDashboardProvider: DashboardProvider = {
  id: DASHBOARD_PROVIDER_ID,
  name: 'YouTube Music',
  kind: 'dashboard',
  metadataProviderId: METADATA_PROVIDER_ID,
  capabilities: ['topTracks', 'newReleases'],
  fetchTopTracks: () => searchTracks('top songs', 20),
  fetchNewReleases: async () => {
    const tracks = await searchTracks('new music releases', 20);
    return tracks
      .filter((track) => track.album)
      .map((track) => track.album!)
      .filter(
        (album, index, albums) =>
          albums.findIndex((item) => item.title === album.title) === index,
      );
  },
};

const youtubeMusicPlaylistProvider: PlaylistProvider = {
  id: PLAYLIST_PROVIDER_ID,
  name: 'YouTube Music',
  kind: 'playlists',
  matchesUrl: (url) =>
    /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(url),
  fetchPlaylistByUrl: async (url) => {
    const playlist = await ytdlpHost.getPlaylist(url);
    const now = new Date().toISOString();

    const items = playlist.entries.map((entry, index) => {
      const thumbnail = entry.thumbnails.at(-1) ?? null;
      const result: YtMusicSearchResult = {
        id: entry.id,
        title: entry.title,
        artists: entry.channel ? [entry.channel] : ['YouTube Music'],
        album: null,
        duration_ms: entry.duration ? Math.round(entry.duration * 1000) : null,
        thumbnail,
        url: `https://music.youtube.com/watch?v=${entry.id}`,
      };

      return {
        id: `${entry.id}-${index}`,
        track: trackFromResult(result),
        addedAtIso: now,
      };
    });

    return {
      id: playlist.id || url,
      name: playlist.title,
      createdAtIso: now,
      lastModifiedIso: now,
      isReadOnly: true,
      origin: {
        provider: PLAYLIST_PROVIDER_ID,
        id: playlist.id || url,
        url,
      },
      items,
    } satisfies Playlist;
  },
};

export const bootstrapBuiltInProviders = async (): Promise<void> => {
  const startedAt = Date.now();
  useStartupStore.getState().startStartup();

  providersHost.register(youtubeMusicStreamingProvider);
  providersHost.register(youtubeMusicMetadataProvider);
  providersHost.register(youtubeMusicDashboardProvider);
  providersHost.register(youtubeMusicPlaylistProvider);
  providersHost.resolveActiveOnBootstrap();

  useStartupStore.getState().finishStartup(Date.now() - startedAt);
};
