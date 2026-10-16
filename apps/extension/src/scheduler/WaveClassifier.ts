import type { FieldSignature } from '@/shared/contracts/field';
import type { ExecutionWave, RuntimeDependency, ScheduledField } from '@/shared/contracts/scheduler';

const STRUCTURAL_LABEL_PATTERNS: RegExp[] = [
  /学历|学位/,
  /证件|身份证|护照/,
  /国家|地区|省|城市|户籍|所在|现居|居住/,
  /是否|至今|在职|应届|学历形式|培养方式/,
  /婚|户口|籍贯/,
  /资格|证书类型/,
];

export interface WaveClassifierOptions {
  dependencies?: RuntimeDependency[];
}

export function matchesStructuralLabel(label: string): boolean {
  if (label === '') {
    return false;
  }
  return STRUCTURAL_LABEL_PATTERNS.some((pattern) => pattern.test(label));
}

export function waveOf(kind: FieldSignature['controlKind'], label: string): ExecutionWave {
  if (kind === 'radio' || kind === 'checkbox') {
    return 'STRUCTURAL';
  }
  if (kind === 'select') {
    return matchesStructuralLabel(label) ? 'STRUCTURAL' : 'COMPLEX';
  }
  if (kind === 'combobox' || kind === 'date') {
    return 'COMPLEX';
  }
  return 'LEAF';
}

export class WaveClassifier {
  classify(fields: FieldSignature[], options: WaveClassifierOptions = {}): ScheduledField[] {
    const dependenciesBySource = new Map<string, string[]>();
    for (const dependency of options.dependencies ?? []) {
      const list = dependenciesBySource.get(dependency.sourceFieldKey);
      if (list === undefined) {
        dependenciesBySource.set(dependency.sourceFieldKey, [dependency.targetFieldKey]);
      } else {
        list.push(dependency.targetFieldKey);
      }
    }
    return fields.map((signature, index) => {
      const wave = waveOf(signature.controlKind, signature.descriptor.normalizedLabel);
      const scheduled: ScheduledField = {
        fieldKey: signature.fieldKey,
        wave,
        priority: index,
        mayMutateStructure: wave === 'STRUCTURAL',
        dependencies: dependenciesBySource.get(signature.fieldKey) ?? [],
      };
      return scheduled;
    });
  }
}
