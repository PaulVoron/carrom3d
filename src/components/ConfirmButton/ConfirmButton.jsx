import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import { orchestrator } from '../../game/GameOrchestrator';
import styles from './ConfirmButton.module.scss';

export const ConfirmButton = () => {
  const gamePhase = useGameStore((state) => state.gamePhase);
  const isPlacementBlocked = useGameStore((state) => state.isPlacementBlocked);

  if (gamePhase !== 'PLACEMENT') {
    return null;
  }

  return (
    <button
      className={styles.button}
      disabled={isPlacementBlocked}
      onClick={() => orchestrator.confirmPlacement()}
    >
      Готов к удару
    </button>
  );
};
