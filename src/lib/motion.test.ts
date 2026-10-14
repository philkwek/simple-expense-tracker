import { describe, expect, it } from 'vitest';
import {
  applyRubberbandBounds,
  getSpringTransition,
  project,
  REDUCED_MOTION_TRANSITION,
  rubberband,
  selectNearestSnapTarget,
  SPRING_CRITICALLY_DAMPED,
  SPRING_MOMENTUM,
} from './motion';

describe('Apple Fluid Interface Physics (motion.ts)', () => {
  describe('project() momentum projection (§6)', () => {
    it('returns 0 for zero velocity', () => {
      expect(project(0)).toBe(0);
    });

    it('projects positive and negative flick velocity symmetrically', () => {
      const forward = project(800, 0.998);
      const backward = project(-800, 0.998);
      expect(forward).toBeGreaterThan(300);
      expect(backward).toBeCloseTo(-forward, 5);
    });

    it('projects shorter distance with snappier deceleration rate (0.99 vs 0.998)', () => {
      const normal = project(500, 0.998);
      const snappy = project(500, 0.99);
      expect(snappy).toBeLessThan(normal);
    });
  });

  describe('selectNearestSnapTarget()', () => {
    it('commits to delete target (-88px) on a fast left flick even from small displacement', () => {
      const target = selectNearestSnapTarget(-18, -600, [0, -88], 0.99);
      expect(target).toBe(-88);
    });

    it('snaps back to 0 when flicked right despite being near -70px', () => {
      const target = selectNearestSnapTarget(-70, 900, [0, -88], 0.99);
      expect(target).toBe(0);
    });
  });

  describe('rubberband() progressive resistance (§9)', () => {
    it('returns 0 when overshoot is 0 or dimension <= 0', () => {
      expect(rubberband(0, 300)).toBe(0);
      expect(rubberband(50, 0)).toBe(0);
    });

    it('resists progressively so output magnitude is always less than raw overshoot and bounded by dimension', () => {
      const smallPull = rubberband(40, 300);
      const largePull = rubberband(200, 300);
      expect(smallPull).toBeGreaterThan(0);
      expect(smallPull).toBeLessThan(40);
      expect(largePull).toBeGreaterThan(smallPull);
      expect(largePull).toBeLessThan(300);
    });

    it('preserves sign for negative overshoots', () => {
      expect(rubberband(-60, 250)).toBeCloseTo(-rubberband(60, 250), 5);
    });
  });

  describe('applyRubberbandBounds()', () => {
    it('tracks 1:1 within [min, max] and rubberbands outside', () => {
      expect(applyRubberbandBounds(-40, -88, 0, 200)).toBe(-40);
      const pastLeft = applyRubberbandBounds(-138, -88, 0, 200);
      expect(pastLeft).toBeLessThan(-88);
      expect(pastLeft).toBeGreaterThan(-138);

      const pastRight = applyRubberbandBounds(50, -88, 0, 200);
      expect(pastRight).toBeGreaterThan(0);
      expect(pastRight).toBeLessThan(50);
    });
  });

  describe('getSpringTransition() (§4 & §14)', () => {
    it('returns non-vestibular tween when prefersReducedMotion is true', () => {
      expect(getSpringTransition(true, 'momentum')).toEqual(REDUCED_MOTION_TRANSITION);
    });

    it('returns critically damped or momentum spring when reduced motion is false', () => {
      expect(getSpringTransition(false, 'standard')).toEqual(SPRING_CRITICALLY_DAMPED);
      expect(getSpringTransition(false, 'momentum')).toEqual(SPRING_MOMENTUM);
    });
  });
});
