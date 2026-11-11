import {createContext, useContext} from 'react';
import type {HomeShape} from './home-shapes.ts';

/**
 * The Home card a component renders in (#1672): its shape and its outer size in CSS pixels, which the unit grid already
 * knows (columns or rows of cells plus the gaps between them). It is undefined off Home, on narrow screens and in the
 * Phone arrangement, where cards take their content height. Cards with compact content read the shape to choose what
 * they show; list cards calculate their rows per page from the size, so no card measures itself.
 */
export type HomeCardBox = {shape: HomeShape; width: number; height: number};
export const HomeShapeContext = createContext<HomeCardBox | undefined>(undefined);
export const useHomeShape = (): HomeShape | undefined => useContext(HomeShapeContext)?.shape;
export const useHomeCardBox = (): HomeCardBox | undefined => useContext(HomeShapeContext);
