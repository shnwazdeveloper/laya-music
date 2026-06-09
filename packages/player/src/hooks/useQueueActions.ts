import { useCallback } from 'react';

import type { Track } from '@nuclearplayer/model';

import { useQueueStore } from '../stores/queueStore';
import { useSoundStore } from '../stores/soundStore';

// You can't replace this with lodash pick because it causes infinite re-renders
export const useQueueActions = () => {
  const {
    addToQueue,
    addNext,
    addAt,
    removeByIds,
    removeByIndices,
    clearQueue,
    reorder,
    updateItemState,
    goToNext,
    goToPrevious,
    goToIndex,
    goToId,
  } = useQueueStore();

  const playNow = useCallback(
    (track: Track) => {
      clearQueue();
      addToQueue([track]);
      useSoundStore.getState().play();
    },
    [clearQueue, addToQueue],
  );

  const playAll = useCallback(
    (tracks: Track[]) => {
      clearQueue();
      addToQueue(tracks);
      useSoundStore.getState().play();
    },
    [clearQueue, addToQueue],
  );

  return {
    addToQueue,
    addNext,
    addAt,
    removeByIds,
    removeByIndices,
    clearQueue,
    reorder,
    updateItemState,
    goToNext,
    goToPrevious,
    goToIndex,
    goToId,
    playNow,
    playAll,
  };
};
