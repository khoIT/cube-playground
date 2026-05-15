import { Meta } from '@cubejs-client/core';

export interface OrderedFunnelCubeRef {
  name: string;
  stepCountMeasure: string;
  stepIndexDimension: string;
  stepNameDimension: string;
}

interface Member {
  name: string;
}

function memberShortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

export function detectOrderedFunnelCube(meta: Meta | null): OrderedFunnelCubeRef | null {
  if (!meta) return null;

  const cubes = (meta as any).meta?.cubes as
    | Array<{ name: string; measures: Member[]; dimensions: Member[] }>
    | undefined;

  if (!cubes) return null;

  for (const cube of cubes) {
    const stepCount = cube.measures?.find((m) => memberShortName(m.name) === 'step_count');
    const stepIndex = cube.dimensions?.find((d) => memberShortName(d.name) === 'step_index');
    const stepName = cube.dimensions?.find((d) => memberShortName(d.name) === 'step_name');

    if (stepCount && stepIndex && stepName) {
      return {
        name: cube.name,
        stepCountMeasure: stepCount.name,
        stepIndexDimension: stepIndex.name,
        stepNameDimension: stepName.name,
      };
    }
  }

  return null;
}
