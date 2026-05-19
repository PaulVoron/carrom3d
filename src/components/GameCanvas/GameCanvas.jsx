import React, { useEffect, useRef } from 'react';
import { orchestrator } from '../../game/GameOrchestrator';
import styles from './GameCanvas.module.scss';

export const GameCanvas = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current) {
      orchestrator.start(canvasRef.current);
    }
    return () => {
      orchestrator.dispose();
    };
  }, []);

  return (
    <div className={styles.canvasContainer}>
      <canvas ref={canvasRef} id="ar_model_view" />
    </div>
  );
};
