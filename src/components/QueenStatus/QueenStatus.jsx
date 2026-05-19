import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import styles from './QueenStatus.module.scss';

export const QueenStatus = () => {
  const queenState = useGameStore((state) => state.queenState);
  const queenCoveredBy = useGameStore((state) => state.queenCoveredBy);

  let statusText = '';
  let statusClass = '';

  switch (queenState) {
    case 'on_board':
      statusText = 'На столе';
      statusClass = styles.onBoard;
      break;
    case 'pocketed_uncovered':
      statusText = 'Забита';
      statusClass = styles.pocketedUncovered;
      break;
    case 'covered':
      statusText = queenCoveredBy ? `Закрыта Игр. ${queenCoveredBy}` : 'Закрыта';
      statusClass = styles.covered;
      break;
    default:
      break;
  }

  return (
    <div className={styles.queenPanel}>
      <div className={styles.queenLabel}>Королева</div>
      <div className={`${styles.queenBadge} ${statusClass}`}>
        {statusText}
      </div>
    </div>
  );
};
