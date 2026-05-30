import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useTranslation } from '../../i18n/translations';
import styles from './ScoreBoard.module.scss';

export const ScoreBoard = () => {
  const score = useGameStore((state) => state.score);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const playerColors = useGameStore((state) => state.playerColors);
  const queenState = useGameStore((state) => state.queenState);
  const queenCoveredBy = useGameStore((state) => state.queenCoveredBy);
  const timeLeft = useGameStore((state) => state.timeLeft);

  const networkMode = useGameStore((state) => state.networkMode);
  const localPlayerRole = useGameStore((state) => state.localPlayerRole);
  const gameMode = useGameStore((state) => state.gameMode);
  const botDifficulty = useGameStore((state) => state.botDifficulty);

  const { t } = useTranslation();

  const getPlayerLabel = (pId) => {
    const color = playerColors[`player${pId}`];
    let colorSuffix = '';
    if (color === 'white') colorSuffix = t('score.colorWhite');
    else if (color === 'black') colorSuffix = t('score.colorBlack');

    if (gameMode === 'pve' && pId === 2) {
      const difficultyText = botDifficulty === 1 ? t('bot.easy') : botDifficulty === 2 ? t('bot.medium') : t('bot.master');
      return `${difficultyText}${colorSuffix}`;
    }

    if (networkMode !== 'local' && localPlayerRole) {
      const name = pId === localPlayerRole ? t('score.you') : t('score.opponent');
      return `${name}${colorSuffix}`;
    }
    return `${t('score.player')} ${pId}${colorSuffix}`;
  };

  const getPlayerScore = (pId) => {
    const color = playerColors[`player${pId}`];
    return color ? score[color] : 0;
  };

  const getTurnText = () => {
    if (gameMode === 'pve') {
      if (currentPlayer === 2) {
        return t('bot.thinking');
      }
      return t('score.yourTurn');
    }
    if (networkMode !== 'local' && localPlayerRole) {
      return currentPlayer === localPlayerRole ? t('score.yourTurn') : t('score.opponentTurn');
    }
    return `${t('score.turnPlayer')} ${currentPlayer}`;
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

  // Форматируем время в MM:SS
  const formatTime = (sec) => {
    if (!sec || sec <= 0) return null;
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const timerDisplay = formatTime(timeLeft);
  const isUrgent = timeLeft > 0 && timeLeft <= 5;

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
        {timerDisplay && (
          <div className={`${styles.timer} ${isUrgent ? styles.timerUrgent : ''}`}>
            {timerDisplay}
          </div>
        )}
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
