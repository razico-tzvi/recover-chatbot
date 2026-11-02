import { useAction, useFindFirst } from "@gadgetinc/react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import {
  DEFAULT_GUIDELINES, DEFAULT_FAQ, DEFAULT_INCENTIVE_INSTRUCTIONS, DEFAULT_SAFEGUARDS_INSTRUCTIONS, DEFAULT_VOICE_TONE,
  resolveBranding, resolveFeatures, resolveSafeguards, DEFAULT_SAFEGUARDS, DEFAULT_FEATURES,
} from "../../api/lib/defaults";

// Context blocks: a block left equal to its default is saved as "" so the
// server keeps using the (possibly updated) built-in default.
export const CONTEXT_DEFAULTS = {
  systemPrompt: DEFAULT_GUIDELINES,
  faq: DEFAULT_FAQ,
  incentiveInstructions: DEFAULT_INCENTIVE_INSTRUCTIONS,
  safeguardsInstructions: DEFAULT_SAFEGUARDS_INSTRUCTIONS,
  voiceTone: DEFAULT_VOICE_TONE,
} as const;
export type ContextKey = keyof typeof CONTEXT_DEFAULTS;

// Write-only secrets: never pre-filled; only sent when the user typed one.
export const SECRET_FIELDS = ["llmApiKey", "freshdeskApiKey", "shipstationApiKey", "shipstationApiSecret"] as const;
export type SecretKey = (typeof SECRET_FIELDS)[number];

export type Draft = {
  botName: string;
  widgetColor: string;
  greeting: string;
  suggestedQuestions: string[];
  disclaimer: string;
  handoffDestination: string;
  handoffEmail: string;
  handoffWebhookUrl: string;
  safeguards: typeof DEFAULT_SAFEGUARDS;
  features: typeof DEFAULT_FEATURES;
  llmProvider: string;
  llmBaseUrl: string;
  llmModel: string;
  anthropicModels: { crm: string; analysis: string };
  freshdeskDomain: string;
} & Record<ContextKey, string> & Record<SecretKey, string>;

function draftFrom(store: any): Draft {
  const b = resolveBranding(store);
  const ctx = Object.fromEntries(
    (Object.keys(CONTEXT_DEFAULTS) as ContextKey[]).map((k) => [k, store?.[k]?.trim() ? store[k] : CONTEXT_DEFAULTS[k]])
  ) as Record<ContextKey, string>;
  return {
    ...ctx,
    botName: b.botName,
    widgetColor: b.widgetColor,
    greeting: b.greeting,
    suggestedQuestions: [...b.suggestedQuestions],
    disclaimer: b.disclaimer,
    handoffDestination: store?.handoffDestination === "crm" ? "crm" : "email",
    handoffEmail: store?.handoffEmail ?? "",
    handoffWebhookUrl: store?.handoffWebhookUrl ?? "",
    safeguards: resolveSafeguards(store),
    features: resolveFeatures(store),
    llmProvider: store?.llmProvider || "anthropic",
    llmBaseUrl: store?.llmBaseUrl ?? "",
    llmModel: store?.llmModel ?? "",
    anthropicModels: { crm: store?.anthropicModels?.crm ?? "", analysis: store?.anthropicModels?.analysis ?? "" },
    freshdeskDomain: store?.freshdeskDomain ?? "",
    llmApiKey: "",
    freshdeskApiKey: "",
    shipstationApiKey: "",
    shipstationApiSecret: "",
  };
}

function toUpdate(store: any, d: Draft) {
  const values: Record<string, any> = {
    id: store.id,
    botName: d.botName.trim(),
    widgetColor: d.widgetColor.trim(),
    greeting: d.greeting.trim(),
    suggestedQuestions: d.suggestedQuestions.map((q) => q.trim()).filter(Boolean),
    disclaimer: d.disclaimer.trim(),
    handoffDestination: d.handoffDestination,
    handoffEmail: d.handoffEmail.trim(),
    handoffWebhookUrl: d.handoffWebhookUrl.trim(),
    safeguards: resolveSafeguards({ safeguards: d.safeguards }),
    features: d.features,
    visionEnabled: !!d.features.vision, // kept for older code paths
    llmProvider: d.llmProvider,
    llmBaseUrl: d.llmBaseUrl.trim(),
    llmModel: d.llmModel.trim(),
    anthropicModels: d.anthropicModels,
    freshdeskDomain: d.freshdeskDomain.trim(),
  };
  for (const k of Object.keys(CONTEXT_DEFAULTS) as ContextKey[]) {
    const v = d[k].trim();
    values[k] = v === CONTEXT_DEFAULTS[k].trim() ? "" : v;
  }
  for (const k of SECRET_FIELDS) if (d[k].trim()) values[k] = d[k].trim();
  return values;
}

type SettingsValue = {
  store: any;
  loading: boolean;
  draft: Draft | null;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  dirty: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  saving: boolean;
  saveError: string | null;
  savedAt: number | null;
  refetch: () => void;
};

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  // @ts-ignore
  const [{ data: store, fetching }, refetch] = useFindFirst(api.bigcommerce.store);
  const [{ fetching: saving }, updateStore] = useAction(api.bigcommerce.store.update);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (store) {
      const d = draftFrom(store);
      setDraft(d);
      setBaseline(JSON.stringify(d));
    }
  }, [store]);

  // Warn before a reload or navigation drops unsaved settings.
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", onUnload);
    return () => removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const value = useMemo<SettingsValue>(() => ({
    store,
    loading: fetching && !store,
    draft,
    set: (key, v) => setDraft((d) => (d ? { ...d, [key]: v } : d)),
    dirty,
    saving,
    saveError,
    savedAt,
    refetch: () => refetch({ requestPolicy: "network-only" }),
    discard: () => {
      if (store) setDraft(draftFrom(store));
      setSaveError(null);
    },
    save: async () => {
      if (!store || !draft) return false;
      setSaveError(null);
      const result = await updateStore(toUpdate(store, draft) as any);
      if (result.error) {
        setSaveError(result.error.message);
        return false;
      }
      setSavedAt(Date.now());
      refetch({ requestPolicy: "network-only" });
      return true;
    },
  }), [store, fetching, draft, baseline, saving, saveError, savedAt]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const v = useContext(SettingsContext);
  if (!v) throw new Error("useSettings must be used inside SettingsProvider");
  return v;
}

// True when the store has a saved value for a write-only secret.
export const hasSecret = (store: any, key: SecretKey) => !!store?.[key];
