import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './ScoreBoard.module.scss';

export const ScoreBoard = () => {
  const score = useGameStore((state) => state.score);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const playerColors = useGameStore((state) => state.playerColors);
  const queenState = useGameStore((state) => state.queenState);
  const queenCoveredBy = useGameStore((state) => state.queenCoveredBy);

  const networkMode = useGameStore((state) => state.networkMode);
  const localPlayerRole = useGameStore((state) => state.localPlayerRole);

  const getPlayerLabel = (pId) => {
    const color = playerColors[`player${pId}`];
    let colorName = '';
    if (color === 'white') colorName = 'Білі';
    else if (color === 'black') colorName = 'Чорні';
    else colorName = 'Обирає...';

    if (networkMode !== 'local' && localPlayerRole) {
      const name = pId === localPlayerRole ? 'Ви' : 'Суперник';
      return `${name} (${colorName})`;
    }
    return `Гравець ${pId} (${colorName})`;
  };

  const getPlayerScore = (pId) => {
    const color = playerColors[`player${pId}`];
    return color ? score[color] : 0;
  };

  const getTurnText = () => {
    if (networkMode !== 'local' && localPlayerRole) {
      return currentPlayer === localPlayerRole ? 'Ваш хід' : 'Грає суперник';
    }
    return `ХІД: ГРАВЕЦЬ ${currentPlayer}`;
  };

  const renderQueenDot = (pId) => {
    if (queenState === 'pocketed_uncovered' && currentPlayer === pId) {
      return <div className={`${styles.queenDot} ${styles.blinking}`}></div>;
    }
    if (queenState === 'covered' && queenCoveredBy === pId) {
      return <div className={`${styles.queenDot}`}></div>;
    }
    return null;
  };

  return (
    <div className={styles.container}>
      <div className={`${styles.playerPanel} ${styles.player1} ${currentPlayer === 1 ? styles.activeP1 : ''}`}>
        <div className={styles.playerName}>{getPlayerLabel(1)}</div>
        <div className={styles.playerScore}>
          {getPlayerScore(1)}
          {renderQueenDot(1)}
        </div>
      </div>

      <div className={styles.centerPanel}>
        <div className={`${styles.turnIndicator} ${currentPlayer === 1 ? styles.turnP1 : styles.turnP2}`}>
          {getTurnText()}
        </div>
      </div>

      <div className={`${styles.playerPanel} ${styles.player2} ${currentPlayer === 2 ? styles.activeP2 : ''}`}>
        <div className={styles.playerName}>{getPlayerLabel(2)}</div>
        <div className={styles.playerScore}>
          {getPlayerScore(2)}
          {renderQueenDot(2)}
        </div>
      </div>
    </div>
  );
};
