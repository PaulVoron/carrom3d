import * as THREE from 'three';
import gsap from 'gsap';
import { useGameStore } from '../store/useGameStore.js';
import { PLAYER_2_LINE_Z, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X } from './InputController.js';
import { PHYSICS } from './PhysicsEngine.js';
import RAPIER from '@dimforge/rapier3d-compat';

export class AIBotManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.isThinking = false;
    this.unsub = useGameStore.subscribe(state => state, (state) => this.onStateChange(state));
  }

  onStateChange(state) {
    if (state.gameMode !== 'pve') return;
    if (state.currentPlayer !== 2) return;
    if (state.gamePhase === 'PLACEMENT' && !this.isThinking && state.isReady) {
      this.isThinking = true;
      // Start AI turn with a small delay for human feel
      setTimeout(() => this.playTurn(), 1000);
    } else if (state.gamePhase !== 'PLACEMENT' && state.gamePhase !== 'AIMING') {
      this.isThinking = false;
    }
  }

  playTurn() {
    const state = useGameStore.getState();
    const difficulty = state.botDifficulty;
    
    // Find valid targets
    const targetInfo = this.findBestTarget();
    if (!targetInfo) {
      // Fallback random shot
      this.executeShot(0, new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5));
      return;
    }

    // Apply difficulty noise
    let noiseAngle = 0;
    if (difficulty === 1) noiseAngle = (Math.random() - 0.5) * (Math.PI / 30); // Easy: ~6 degrees
    if (difficulty === 2) noiseAngle = (Math.random() - 0.5) * (Math.PI / 180); // Medium: ~1 degree
    
    let impulse = targetInfo.impulse;
    if (noiseAngle !== 0) {
      impulse.applyAxisAngle(new THREE.Vector3(0, 1, 0), noiseAngle);
    }
    
    // Add force noise for lower difficulties
    if (difficulty === 1) {
      impulse.multiplyScalar(0.8 + Math.random() * 0.4);
    } else if (difficulty === 2) {
      impulse.multiplyScalar(0.9 + Math.random() * 0.2);
    }

    // Clamp impulse to max pull distance
    if (impulse.length() > PHYSICS.maxPullDistance) {
      impulse.setLength(PHYSICS.maxPullDistance);
    }

    this.executeShot(targetInfo.strikerX, impulse);
  }

  findBestTarget() {
    const state = useGameStore.getState();
    const myColor = state.playerColors.player2; 
    const bodies = this.orchestrator.physics.physicsBodies;
    
    const validTargets = [];
    
    bodies.forEach(entry => {
      const type = entry.mesh.userData.type;
      if (!entry.body.isEnabled()) return;
      if (type === 'striker') return;
      
      let isValidColor = false;
      if (!myColor) {
        if (type === 'white' || type === 'black' || type === 'queen') isValidColor = true;
      } else {
        if (type === myColor) isValidColor = true;
        if (type === 'queen' && state.queenState !== 'covered') isValidColor = true;
      }
      
      if (isValidColor) {
        validTargets.push(entry);
      }
    });

    if (validTargets.length === 0) return null;

    const pockets = this.orchestrator.physics.pocketCenters;
    
    let bestTarget = null;
    let minScore = Infinity; 

    for (const target of validTargets) {
      const pos = target.body.translation();
      
      for (const pocket of pockets) {
        const toPocket = new THREE.Vector3(pocket.x - pos.x, 0, pocket.z - pos.z);
        const distToPocket = toPocket.length();
        const dirToPocket = toPocket.clone().normalize();
        
        // Where the striker needs to be to hit the target into the pocket
        const hitPoint = new THREE.Vector3(pos.x, pos.y, pos.z).sub(dirToPocket.clone().multiplyScalar(PHYSICS.coinDia / 2 + PHYSICS.strikerDia / 2));
        
        // Check if path from hitPoint to pocket is clear (ignore target coin)
        if (!this.isPathClear(hitPoint, pocket, target.body)) continue;
        
        // Sample placements
        for (let x = PLAYER_LINE_MIN_X; x <= PLAYER_LINE_MAX_X; x += 0.05) {
          const strikerPos = new THREE.Vector3(x, hitPoint.y, PLAYER_2_LINE_Z);
          
          const toHitPoint = hitPoint.clone().sub(strikerPos);
          const distToHitPoint = toHitPoint.length();
          const dirToHitPoint = toHitPoint.clone().normalize();
          
          if (dirToHitPoint.z < 0.05) continue; // Must shoot forward (positive Z for player 2)
          
          // Check if path from striker to hitPoint is clear (ignore striker)
          if (!this.isPathClear(strikerPos, hitPoint, this.orchestrator.rules.strikerEntry.body)) continue;
          
          const isValidPlacement = this.orchestrator.input.validatePlacement(
            x, PLAYER_2_LINE_Z, bodies, this.orchestrator.rules.strikerEntry, PHYSICS.strikerDia / 2, PHYSICS.coinDia / 2
          );
          
          if (!isValidPlacement) continue;
          
          const cutAngle = dirToHitPoint.angleTo(dirToPocket);
          const score = distToPocket + distToHitPoint + cutAngle * 0.5;
          
          if (score < minScore) {
            minScore = score;
            const totalDist = distToPocket + distToHitPoint;
            
            let force;
            if (this.orchestrator.rules._isFirstStrike) {
              force = PHYSICS.maxPullDistance; // Hard break shot
            } else {
              // Calibrated softer force for regular play
              force = Math.min(totalDist * 0.12 + 0.03, PHYSICS.maxPullDistance); 
            }
            
            bestTarget = {
              strikerX: x,
              impulse: dirToHitPoint.clone().multiplyScalar(force) 
            };
          }
        }
      }
    }

    if (bestTarget) return bestTarget;

    // Fallback: Shoot directly at the first valid target softly
    const fallbackTarget = validTargets[0];
    const pos = fallbackTarget.body.translation();
    const x = THREE.MathUtils.clamp(pos.x, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X);
    const toTarget = new THREE.Vector3(pos.x - x, 0, pos.z - PLAYER_2_LINE_Z);
    
    let fallbackForce = 0.08;
    if (this.orchestrator.rules._isFirstStrike) {
      fallbackForce = PHYSICS.maxPullDistance;
    }
    
    return {
      strikerX: x,
      impulse: toTarget.normalize().multiplyScalar(fallbackForce)
    };
  }

  isPathClear(start, end, ignoreBody) {
    const dirVec = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
    const maxToi = dirVec.length();
    if (maxToi < 0.001) return true;
    
    dirVec.normalize();
    const direction = new RAPIER.Vector3(dirVec.x, 0, dirVec.z);
    
    let t = 0.001; 
    while (t < maxToi) {
      const o = new RAPIER.Vector3(start.x + dirVec.x * t, 0.005, start.z + dirVec.z * t);
      const r = new RAPIER.Ray(o, direction);
      
      const hit = this.orchestrator.physics.world.castRay(r, maxToi - t, true, 0x00010001);
      if (!hit) break;
      
      if (ignoreBody && hit.collider.parent() === ignoreBody.handle) {
        t += hit.toi + 0.02; // step slightly past it
      } else {
        return false; 
      }
    }
    return true;
  }

  executeShot(x, impulse) {
    const startX = this.orchestrator.rules.strikerEntry.mesh.position.x;
    const durSlide = Math.abs(x - startX) * 2 + 0.5; 
    
    const dragObj = { val: startX };
    
    gsap.to(dragObj, {
      val: x,
      duration: durSlide,
      ease: "power1.inOut",
      onUpdate: () => {
        this.orchestrator.rules.onStrikerDrag(dragObj.val, 2);
      },
      onComplete: () => {
        setTimeout(() => {
          this.orchestrator.rules.confirmPlacement(true); 
          
          const currentImpulse = this.orchestrator.input.currentImpulse;
          
          gsap.to(currentImpulse, {
            x: impulse.x,
            y: impulse.y,
            z: impulse.z,
            duration: 1.0,
            ease: "power2.out",
            onComplete: () => {
              setTimeout(() => {
                this.orchestrator.rules.shoot(currentImpulse, true);
                currentImpulse.set(0,0,0);
              }, 200);
            }
          });
        }, 500);
      }
    });
  }

  dispose() {
    this.unsub();
  }
}
