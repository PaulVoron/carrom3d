import React from 'react';
import { useGameStore } from '../../store/useGameStore';
import { networkManager } from '../../engine/NetworkManager';
import { useTranslation } from '../../i18n/translations';
import styles from './ColorSelectionPopup.module.scss';

export const ColorSelectionPopup = () => {
  const showColorSelection = useGameStore((state) => state.showColorSelection);
  const currentPlayer = useGameStore((state) => state.currentPlayer);
  const localPlayerRole = useGameStore((state) => state.localPlayerRole);
  const networkMode = useGameStore((state) => state.networkMode);
  const selectPlayerColor = useGameStore((state) => state.selectPlayerColor);
  const { t } = useTranslation();

  if (!showColorSelection) return null;

  const isMyTurn = networkMode === 'local' || currentPlayer === localPlayerRole;

  const handleSelect = (color) => {
    if (!isMyTurn) return;

    // Локально обновляем стор
    selectPlayerColor(color);

    // Отправляем по сети
    if (networkMode === 'host') {
      networkManager.send('SYNC_COLOR_SELECTION', {
        playerColors: useGameStore.getState().playerColors
      });
    } else if (networkMode === 'client') {
      networkManager.send('CLIENT_SELECT_COLOR', { color });
    }
  };

  const opponentText = t('colorpick.opponentChoosing').replace('{n}', currentPlayer);

  return (
    <div className={styles.container}>
      <div className={styles.popup}>
        <h3 className={styles.title}>{t('colorpick.title')}</h3>
        <p className={styles.subtitle}>
          {isMyTurn ? t('colorpick.myTurn') : opponentText}
        </p>

        {isMyTurn ? (
          <div className={styles.buttonGroup}>
            <button
              className={`${styles.colorBtn} ${styles.whiteBtn}`}
              onClick={() => handleSelect('white')}
            >
              <div className={styles.colorPreviewWhite} />
              <span>{t('colorpick.white')}</span>
            </button>
            <button
              className={`${styles.colorBtn} ${styles.blackBtn}`}
              onClick={() => handleSelect('black')}
            >
              <div className={styles.colorPreviewBlack} />
              <span>{t('colorpick.black')}</span>
            </button>
          </div>
        ) : (
          <div className={styles.loaderContainer}>
            <div className={styles.spinner} />
            <span>{t('colorpick.waiting')}</span>
          </div>
        )}
      </div>
    </div>
  );
};
