/**
 * Concept = unified shape across measure / dimension / segment. The Data
 * Model tab flattens cube /meta into one list keyed by FQN.
 */

export type ConceptType = 'measure' | 'dimension' | 'segment';

export interface Concept {
  type: ConceptType;
  cubeKind: 'cube' | 'view';
  fqn: string;
  cube: string;
  name: string;
  description?: string;
  title?: string;
  meta?: {
    aggType?: string;
    format?: string;
    dimensionType?: string;
    primaryKey?: boolean;
    source?: string;
    cdpProjection?: boolean;
  };
}
