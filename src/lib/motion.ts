import { Transition, ValueAnimationTransition } from 'framer-motion';

/**
 * Apple WWDC "Designing Fluid Interfaces" Spring & Gesture Physics
 *
 * - Damping ratio 1.0 (critically damped, zero overshoot) for standard UI transitions,
 *   repositioning, and expandable drawers.
 * - Damping ratio ~0.8 (slight bounce) ONLY when a gesture (flick, throw, sheet release)
 *   carries momentum into the spring.
 */

export const SPRING_CRITICALLY_DAMPED: ValueAnimationTransition<number> = {
  type: 'spring',
  bounce: 0,
  duration: 0.38,
};

export const SPRING_MOMENTUM: ValueAnimationTransition<number> = {
  type: 'spring',
  bounce: 0.18,
  duration: 0.32,
};

export const SPRING_SNAPPY: ValueAnimationTransition<number> = {
  type: 'spring',
  bounce: 0,
  duration: 0.26,
};

export const REDUCED_MOTION_TRANSITION: ValueAnimationTransition<number> = {
  type: 'tween',
  ease: 'easeOut',
  duration: 0.18,
};

/**
 * Returns the appropriate transition honoring the user's reduced-motion preference (§14).
 */
export function getSpringTransition(
  prefersReducedMotion: boolean | null,
  variant: 'standard' | 'momentum' | 'snappy' = 'standard',
): Transition {
  if (prefersReducedMotion) {
    return REDUCED_MOTION_TRANSITION;
  }
  if (variant === 'momentum') return SPRING_MOMENTUM;
  if (variant === 'snappy') return SPRING_SNAPPY;
  return SPRING_CRITICALLY_DAMPED;
}

/**
 * §6 Momentum Projection (WWDC 2018 Designing Fluid Interfaces)
 *
 * Projects the resting position of a gesture based on initial release velocity (px/s)
 * and exponential scroll deceleration rate (0.998 normal, 0.99 snappy).
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  if (!Number.isFinite(initialVelocity) || initialVelocity === 0) return 0;
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Projects the endpoint from current position + velocity and picks the nearest snap target.
 */
export function selectNearestSnapTarget(
  currentPosition: number,
  releaseVelocity: number,
  snapTargets: number[],
  decelerationRate = 0.998,
): number {
  if (snapTargets.length === 0) return currentPosition;
  const projectedEndpoint = currentPosition + project(releaseVelocity, decelerationRate);
  let nearest = snapTargets[0];
  let minDistance = Math.abs(projectedEndpoint - nearest);

  for (let i = 1; i < snapTargets.length; i++) {
    const dist = Math.abs(projectedEndpoint - snapTargets[i]);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = snapTargets[i];
    }
  }
  return nearest;
}

/**
 * §9 Progressive Rubber-Banding at Soft Boundaries
 *
 * The further past a boundary the user drags, the more the element resists:
 * (overshoot * dimension * constant) / (dimension + constant * |overshoot|)
 */
export function rubberband(
  overshoot: number,
  dimension: number,
  constant = 0.55,
): number {
  if (dimension <= 0 || overshoot === 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const absOvershoot = Math.abs(overshoot);
  return (
    sign *
    ((absOvershoot * dimension * constant) /
      (dimension + constant * absOvershoot))
  );
}

/**
 * Applies 1:1 tracking inside [min, max] and progressive rubber-band resistance outside.
 */
export function applyRubberbandBounds(
  value: number,
  min: number,
  max: number,
  dimension: number,
  constant = 0.55,
): number {
  if (value < min) {
    return min + rubberband(value - min, dimension, constant);
  }
  if (value > max) {
    return max + rubberband(value - max, dimension, constant);
  }
  return value;
}
