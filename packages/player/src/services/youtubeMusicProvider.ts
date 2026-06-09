import { invoke } from '@tauri-apps/api/core';

import type {
  ArtworkSet,
  Playlist,
  Stream,
  StreamCandidate,
  Track,
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
  maxResults = 20,
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

const trackFromResult = (result: YtMusicSearchResult): Track => {
  const artwork = artworkFromThumbnail(result.thumbnail);
  const artists = result.artists.length ? result.artists : ['YouTube Music'];

  return {
    title: result.title,
    artists: artists.map((name) => ({
      name,
      roles: ['main'],
      source: providerRef(`artist:${name}`),
    })),
    album: result.album
      ? {
          title: result.album,
          artists: artists.map((name) => ({
            name,
            source: providerRef(`artist:${name}`),
          })),
          artwork,
          source: providerRef(`album:${result.id}`, result.url),
        }
      : undefined,
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
  const results = await ytmusicSearch(query, limit ?? 20);
  return results.map(trackFromResult);
};

const youtubeMusicMetadataProvider: MetadataProvider = {
  id: METADATA_PROVIDER_ID,
  name: 'YouTube Music',
  kind: 'metadata',
  searchCapabilities: ['unified', 'tracks'],
  streamingProviderId: STREAMING_PROVIDER_ID,
  search: async ({ query, limit }) => ({
    tracks: await searchTracks(query, limit),
  }),
  searchTracks: async ({ query, limit }) => searchTracks(query, limit),
};

const youtubeMusicStreamingProvider: StreamingProvider = {
  id: STREAMING_PROVIDER_ID,
  name: 'YouTube Music',
  kind: 'streaming',
  searchForTrack: async (artist, title, album) => {
    const query = [artist, title, album].filter(Boolean).join(' ');
    const results = await ytmusicSearch(query, 5);
    return results.map(candidateFromResult);
  },
  searchForTrackV2: async (track) => {
    if (track.source.provider === METADATA_PROVIDER_ID) {
      return [candidateFromTrack(track)];
    }

    const artist = track.artists[0]?.name;
    const query = [artist, track.title, track.album?.title]
      .filter(Boolean)
      .join(' ');
    const results = await ytmusicSearch(query, 5);
    return results.map(candidateFromResult);
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
