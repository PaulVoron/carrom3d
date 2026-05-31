import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useTranslation } from '../../i18n/translations';
import styles from './ChallengePopup.module.scss';
import { CHALLENGE_LEVELS } from '../../config/levels';
import { orchestrator } from '../../game/GameOrchestrator';

export const ChallengePopup = () => {
  const challengeResult = useGameStore((state) => state.challengeResult);
  const currentLevelId = useGameStore((state) => state.currentLevelId);
  const nextLevelAction = useGameStore((state) => state.nextLevel);
  const resetChallengeAction = useGameStore((state) => state.resetChallenge);

  const { t } = useTranslation();

  if (!challengeResult) return null;

  const isWin = challengeResult.status === 'win';
  const hasNextLevel = CHALLENGE_LEVELS.some((l) => l.id === currentLevelId + 1);

  const handleNext = () => {
    nextLevelAction();
    orchestrator.restartGame(1);
  };

  const handleRetry = () => {
    resetChallengeAction();
    orchestrator.restartGame(1);
  };

  const renderStars = () => {
    if (!isWin) return null;
    const stars = [];
    for (let i = 0; i < 3; i++) {
      stars.push(
        <span key={i} className={i < challengeResult.stars ? styles.starFilled : styles.starEmpty}>
          ★
        </span>
      );
    }
    return <div className={styles.starsContainer}>{stars}</div>;
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.popup}>
        <h2 className={isWin ? styles.titleWin : styles.titleLose}>
          {isWin ? t('challenge.passed') : t('challenge.failed')}
        </h2>
        {renderStars()}
        <div className={styles.actions}>
          {isWin && hasNextLevel && (
            <button className={styles.primaryBtn} onClick={handleNext}>
              {t('challenge.nextLevel')}
            </button>
          )}
          <button className={isWin && hasNextLevel ? styles.secondaryBtn : styles.primaryBtn} onClick={handleRetry}>
            {t('challenge.retry')}
          </button>
        </div>
      </div>
    </div>
  );
};
