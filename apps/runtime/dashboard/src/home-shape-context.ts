import {createContext, useContext} from 'react';
import type {HomeShape} from './home-shapes.ts';

/**
 * The shape of the Home card a component renders in (#1672), or undefined off Home, on narrow screens and in the Phone
 * arrangement, where cards take their content height. Cards with compact content read it to choose what they show.
 */
export const HomeShapeContext = createContext<HomeShape | undefined>(undefined);
export const useHomeShape = (): HomeShape | undefined => useContext(HomeShapeContext);
