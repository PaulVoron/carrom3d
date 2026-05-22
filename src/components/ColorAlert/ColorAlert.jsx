import React, { useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useTranslation } from '../../i18n/translations';
import styles from './ColorAlert.module.scss';

export const ColorAlert = () => {
  const trigger = useGameStore(s => s.colorAssignmentAlert);
  const clearAlert = useGameStore(s => s.clearColorAssignmentAlert);
  const mode = useGameStore(s => s.networkMode);
  const playerColors = useGameStore(s => s.playerColors);
  const localPlayerRole = useGameStore(s => s.localPlayerRole);
  const { t } = useTranslation();

  useEffect(() => {
    if (trigger) {
      const timer = setTimeout(clearAlert, 4000);
      return () => clearTimeout(timer);
    }
  }, [trigger, clearAlert]);

  if (!trigger) return null;

  const myColor = mode === 'local'
    ? playerColors.player1
    : (localPlayerRole === 1 ? playerColors.player1 : playerColors.player2);

  let textKey;
  if (mode === 'local') {
    textKey = myColor === 'white' ? 'coloralert.player1White' : 'coloralert.player1Black';
  } else {
    textKey = myColor === 'white' ? 'coloralert.youWhite' : 'coloralert.youBlack';
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>{t(textKey)}</div>
    </div>
  );
};
