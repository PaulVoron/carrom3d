import React, { useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useTranslation } from '../../i18n/translations';
import styles from './ColorAlert.module.scss';

export const ColorAlert = () => {
  const trigger = useGameStore(s => s.colorAssignmentAlert);
  const clearAlert = useGameStore(s => s.clearColorAssignmentAlert);
  const mode = useGameStore(s => s.networkMode);
  const playerColors = useGameStore(s => s.playerColors);
  const localPlayerRole = useGameStore(state => state.localPlayerRole);
  const networkMode = useGameStore(state => state.networkMode);
  const currentCoinNames = useGameStore(state => state.currentCoinNames);
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

  let text = t(textKey);
  
  if (currentCoinNames) {
    if (myColor === 'white') text = text.replace(t('score.colorWhite'), currentCoinNames.white).replace(t('colorpick.white'), currentCoinNames.white);
    if (myColor === 'black') text = text.replace(t('score.colorBlack'), currentCoinNames.black).replace(t('colorpick.black'), currentCoinNames.black);
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>{text}</div>
    </div>
  );
};
