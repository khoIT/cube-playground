import { CubeApi, Meta, Query, ResultSet } from '@cubejs-client/core';

import { Cube } from '../types';

interface DimensionMember {
  name: string;
  type?: string;
}

interface MeasureMember {
  name: string;
  type?: string;
}

export interface BreakdownSample {
  dimensions: string[];
  measures: string[];
}

export interface DistributionSample {
  measure: string;
}

export interface FunnelSample {
  eventDim: string;
  steps: string[];
}

const EVENT_DIM_REGEX = /^(event(_?name|_?type)?|action)$/i;
const ID_TAIL_REGEX = /(_id|id)$/i;

function memberShortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

export function detectSampleCube(meta: Meta | null, usedCubes: string[]): Cube | null {
  if (!meta) return null;

  const cubes = (meta as any).meta?.cubes as Cube[] | undefined;

  if (!cubes || cubes.length === 0) return null;

  if (usedCubes.length > 0) {
    const used = cubes.find((c) => c.name === usedCubes[0]);
    if (used) return used;
  }

  return cubes[0];
}

export function detectBreakdownInputs(cube: Cube | null): BreakdownSample | null {
  if (!cube) return null;

  const dimensions = (cube.dimensions as DimensionMember[]) || [];
  const measures = (cube.measures as MeasureMember[]) || [];

  const categoricalDims = dimensions
    .filter((d) => d.type === 'string' && !ID_TAIL_REGEX.test(memberShortName(d.name)))
    .slice(0, 2);

  const numericMeasure = measures.find(
    (m) => m.type === 'number' || /count|sum|avg/i.test(m.name)
  );

  if (categoricalDims.length === 0 || !numericMeasure) return null;

  return {
    dimensions: categoricalDims.map((d) => d.name),
    measures: [numericMeasure.name],
  };
}

export function detectDistributionInputs(cube: Cube | null): DistributionSample | null {
  if (!cube) return null;

  const measures = (cube.measures as MeasureMember[]) || [];
  const numericMeasure = measures.find((m) => {
    const short = memberShortName(m.name);

    if (ID_TAIL_REGEX.test(short)) return false;
    return m.type === 'number' || /count|sum|avg/i.test(m.name);
  });

  if (!numericMeasure) return null;

  return { measure: numericMeasure.name };
}

export function detectEventDim(cube: Cube | null): string | null {
  if (!cube) return null;

  const dimensions = (cube.dimensions as DimensionMember[]) || [];
  const named = dimensions.find((d) => EVENT_DIM_REGEX.test(memberShortName(d.name)));

  if (named) return named.name;

  const firstString = dimensions.find((d) => d.type === 'string');
  return firstString?.name ?? null;
}

export async function fetchEventSamples(
  cubeApi: CubeApi,
  eventDim: string,
  limit = 3
): Promise<string[]> {
  const query: Query = {
    dimensions: [eventDim],
    limit,
  };

  const rs: ResultSet = await cubeApi.load(query);
  const raw = rs.rawData();

  return raw
    .map((row: any) => row?.[eventDim])
    .filter((v: any) => v != null && v !== '')
    .map(String);
}
