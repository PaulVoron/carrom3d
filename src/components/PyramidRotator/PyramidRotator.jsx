/**
 * PyramidRotator.jsx
 * Glassmorphism-панель для вращения начальной пирамиды фишек.
 * Отображается только в самом начале матча, до нажатия "Применить".
 *
 * Условия показа:
 *  - isReady === true
 *  - gamePhase === 'PLACEMENT'
 *  - isPyramidLocked === false
 *  - Счёт 0:0
 *  - Локальный активный игрок (первый ход)
 */

import React, { useCallback } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useTranslation } from '../../i18n/translations';
import { orchestrator } from '../../game/GameOrchestrator';
import styles from './PyramidRotator.module.scss';

export const PyramidRotator = () => {
  const { t } = useTranslation();

  const gamePhase       = useGameStore((s) => s.gamePhase);
  const isPyramidLocked = useGameStore((s) => s.isPyramidLocked);
  const pyramidRotation = useGameStore((s) => s.pyramidRotation);
  const score           = useGameStore((s) => s.score);
  const currentPlayer   = useGameStore((s) => s.currentPlayer);
  const networkMode     = useGameStore((s) => s.networkMode);
  const localPlayerRole = useGameStore((s) => s.localPlayerRole);
  const gameMode        = useGameStore((s) => s.gameMode);
  const setPyramidRotation = useGameStore((s) => s.setPyramidRotation);

  // Определяем, является ли локальный игрок тем, кто управляет пирамидой
  const isActivePlayer = (() => {
    if (gameMode === 'pve' && currentPlayer === 2) return false;
    if (networkMode === 'local') return true;
    return currentPlayer === localPlayerRole;
  })();

  const isFirstTurn = score.white === 0 && score.black === 0;

  const degValue = Math.round(pyramidRotation * (180 / Math.PI));

  const handleSliderChange = useCallback((e) => {
    const deg = parseFloat(e.target.value);
    const rad = deg * (Math.PI / 180);
    setPyramidRotation(rad);
  }, [setPyramidRotation]);

  const handleApply = useCallback(() => {
    orchestrator.applyPyramidRotation();
  }, []);

  // Показываем только если: PLACEMENT + не заблокировано + первый ход + активный игрок
  if (
    gamePhase !== 'PLACEMENT' ||
    isPyramidLocked ||
    !isFirstTurn ||
    !isActivePlayer
  ) {
    return null;
  }

  return (
    <div className={styles.container} role="region" aria-label={t('pyramid.rotate')}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.icon}>🎯</span>
          <span className={styles.title}>{t('pyramid.rotate')}</span>
          <span className={styles.degrees}>{degValue > 0 ? `+${degValue}°` : `${degValue}°`}</span>
        </div>

        <div className={styles.sliderWrapper}>
          <span className={styles.sliderEndLabel}>−180°</span>
          <input
            id="pyramid-rotation-slider"
            type="range"
            min="-180"
            max="180"
            step="1"
            value={degValue}
            onChange={handleSliderChange}
            className={styles.slider}
            style={{ '--pct': `${((degValue + 180) / 360) * 100}%` }}
            aria-label={t('pyramid.rotate')}
          />
          <span className={styles.sliderEndLabel}>+180°</span>
        </div>

        <button
          id="pyramid-apply-btn"
          className={styles.applyBtn}
          onClick={handleApply}
          aria-label={t('pyramid.apply')}
        >
          {t('pyramid.apply')}
        </button>
      </div>
    </div>
  );
};
