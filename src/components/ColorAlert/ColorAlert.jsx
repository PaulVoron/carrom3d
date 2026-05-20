import React, { useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './ColorAlert.module.scss';

export const ColorAlert = () => {
  const trigger = useGameStore(s => s.colorAssignmentAlert);
  const clearAlert = useGameStore(s => s.clearColorAssignmentAlert);
  const mode = useGameStore(s => s.networkMode);
  const playerColors = useGameStore(s => s.playerColors);
  const localPlayerRole = useGameStore(s => s.localPlayerRole);

  useEffect(() => {
    if (trigger) {
      const t = setTimeout(clearAlert, 4000);
      return () => clearTimeout(t);
    }
  }, [trigger, clearAlert]);

  if (!trigger) return null;

  const myColor = mode === 'local' ? playerColors.player1 : (localPlayerRole === 1 ? playerColors.player1 : playerColors.player2);
  const colorName = myColor === 'white' ? 'Білі' : 'Чорні';
  const text = mode === 'local' ? `Гравцю 1 призначено: ${colorName}` : `Ваш колір: ${colorName}`;

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>{text}</div>
    </div>
  );
};
