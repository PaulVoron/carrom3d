import React, { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n/translations';
import styles from './FullscreenButton.module.scss';

export const FullscreenButton = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(
        !!(document.fullscreenElement || 
           document.webkitFullscreenElement || 
           document.mozFullScreenElement || 
           document.msFullscreenElement)
      );
    };

    // Слушатели изменений полноэкранного режима (включая вендорные префиксы для мобильных браузеров)
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Первичная синхронизация состояния при монтировании
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      const docEl = document.documentElement;
      
      const isCurrentlyFullscreen = 
        document.fullscreenElement || 
        document.webkitFullscreenElement || 
        document.mozFullScreenElement || 
        document.msFullscreenElement;

      if (!isCurrentlyFullscreen) {
        // Переход в полноэкранный режим
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        } else if (docEl.mozRequestFullScreen) {
          await docEl.mozRequestFullScreen();
        } else if (docEl.msRequestFullscreen) {
          await docEl.msRequestFullscreen();
        }
      } else {
        // Выход из полноэкранного режима
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Не удалось переключить полноэкранный режим:', err);
    }
  };

  return (
    <button
      id="fullscreen-toggle-btn"
      className={styles.fullscreenBtn}
      onClick={toggleFullscreen}
      title={isFullscreen ? t('fullscreen.exitText') : t('fullscreen.enterText')}
      aria-label={isFullscreen ? t('fullscreen.exitText') : t('fullscreen.enterText')}
    >
      <span className={styles.icon}>
        {isFullscreen ? '✖' : '🔲'}
      </span>
      <span className={styles.text}>
        {isFullscreen ? t('fullscreen.exitText') : t('fullscreen.enterText')}
      </span>
    </button>
  );
};
