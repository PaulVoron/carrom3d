import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import { orchestrator } from '../../game/GameOrchestrator';
import { useTranslation } from '../../i18n/translations';
import styles from './ConfirmButton.module.scss';

export const ConfirmButton = () => {
  const gamePhase = useGameStore((state) => state.gamePhase);
  const isPlacementBlocked = useGameStore((state) => state.isPlacementBlocked);
  const isPyramidLocked = useGameStore((state) => state.isPyramidLocked);
  const score = useGameStore((state) => state.score);
  const networkMode = useGameStore((state) => state.networkMode);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const localPlayerRole = useGameStore((state) => state.localPlayerRole);
  const gameMode = useGameStore((state) => state.gameMode);

  const { t } = useTranslation();

  const isActive = networkMode === 'local' || currentPlayer === localPlayerRole;

  if (gamePhase !== 'PLACEMENT') {
    return null;
  }

  // Не показываем кнопку готовности, пока пирамида не заблокирована на первом ходу
  const isFirstTurn = score.white === 0 && score.black === 0;
  if (isFirstTurn && !isPyramidLocked) {
    return null;
  }

  if (gameMode === 'pve' && currentPlayer === 2) {
    return null;
  }

  return (
    <button
      id="confirm-placement-btn"
      className={styles.button}
      disabled={isPlacementBlocked || !isActive}
      onClick={() => orchestrator.confirmPlacement()}
    >
      {t('confirm.ready')}
    </button>
  );
};
