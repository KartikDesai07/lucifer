// Typed wrapper around the Kotlin module NativeModules.PosUpdate (native apps 2.0, spec §6): the update card offered at
// an app open. When the module is missing (iOS, tests) nothing is offered: no card, nothing to install. A call never
// rejects: a failed takeCard is no card, a failed install is "failed".

import { NativeModules } from 'react-native';

/** What the card shows: the verified update's version and its notes ("" when none). */
export type UpdateCardInfo = { version: string; notes: string };

/** What a tap on Install started (Kotlin's UpdateInstaller.InstallStart). */
export type InstallAnswer = 'started' | 'permission' | 'missing' | 'failed';

export interface PosUpdateModule {
  takeCard(): Promise<UpdateCardInfo | null>;
  install(): Promise<InstallAnswer>;
  later(): void;
}

/** Kotlin's PosUpdateModule.CARD_EVENT: a card that waited for a print to finish. */
export const UPDATE_CARD_EVENT = 'PosUpdateCard';
/** Kotlin's PosUpdateModule.RESULT_EVENT: Android's installer failed, or the user cancelled its dialog. */
export const UPDATE_RESULT_EVENT = 'PosUpdateResult';

type MethodName = keyof PosUpdateModule;

// Looked up per call so a late-registered or test-stubbed module is found.
function call<M extends MethodName>(
  name: M,
): ReturnType<PosUpdateModule[M]> | undefined {
  const module = (NativeModules as { PosUpdate?: Partial<PosUpdateModule> })
    .PosUpdate;
  const fn = module?.[name] as
    | (() => ReturnType<PosUpdateModule[M]>)
    | undefined;
  if (typeof fn !== 'function') {
    return undefined;
  }
  try {
    return fn.apply(module);
  } catch {
    return undefined;
  }
}

export const PosUpdate: PosUpdateModule = {
  takeCard: () => (call('takeCard') ?? Promise.resolve(null)).catch(() => null),
  install: () =>
    (call('install') ?? Promise.resolve<InstallAnswer>('missing')).catch(
      (): InstallAnswer => 'failed',
    ),
  later: () => {
    call('later');
  },
};
