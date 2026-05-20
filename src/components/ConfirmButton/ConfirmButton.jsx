import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import { orchestrator } from '../../game/GameOrchestrator';
import styles from './ConfirmButton.module.scss';

export const ConfirmButton = () => {
  const gamePhase = useGameStore((state) => state.gamePhase);
  const isPlacementBlocked = useGameStore((state) => state.isPlacementBlocked);
  const networkMode = useGameStore((state) => state.networkMode);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const localPlayerRole = useGameStore((state) => state.localPlayerRole);

  const isActive = networkMode === 'local' || currentPlayer === localPlayerRole;

  if (gamePhase !== 'PLACEMENT') {
    return null;
  }

  return (
    <button
      className={styles.button}
      disabled={isPlacementBlocked || !isActive}
      onClick={() => orchestrator.confirmPlacement()}
    >
      Готовий до удару
    </button>
  );
};
