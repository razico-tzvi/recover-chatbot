import { Box, Panel, Text, Flex, Link, Form, FormGroup, Input, Select, Button, Message, Checkbox } from "@bigcommerce/big-design";
import { CheckIcon, StoreIcon } from "@bigcommerce/big-design-icons";
import { useFindFirst, useAction } from "@gadgetinc/react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";

export const IndexPage = () => {
  // @ts-ignore
  const [{ data, fetching, error }] = useFindFirst(api.bigcommerce.store);

  return (
    <>
      <Panel description={<Flex flexGap={"8px"}><CheckIcon color="success" /> <Text>Successfully connected your Gadget app to BigCommerce</Text></Flex>}>
        <div style={{ width: "100%" }}>
          <Flex flexDirection="column" alignItems="center">
            <img src="https://assets.gadget.dev/assets/icon.svg" style={{ margin: "14px auto", height: "44px" }} />
            <Text>Store: <b>{
              // @ts-ignore
              `store-${data?.storeHash}.mybigcommerce.com`
            }</b></Text>
          </Flex>
        </div>
      </Panel>

      <LlmSettingsPanel store={data} loading={fetching} />
    </>
  );
};

const CLAUDE_MODELS = [
  { value: "claude-opus-4-8", content: "Claude Opus 4.8 — most capable" },
  { value: "claude-sonnet-5", content: "Claude Sonnet 5 — balanced (recommended)" },
  { value: "claude-haiku-4-5", content: "Claude Haiku 4.5 — fastest & cheapest" },
];

function LlmSettingsPanel({ store, loading }: { store: any; loading: boolean }) {
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [visionOn, setVisionOn] = useState(false);
  const [saved, setSaved] = useState(false);

  const [{ fetching: saving, error: saveError }, updateStore] = useAction(api.bigcommerce.store.update);

  // Load current values when the store record arrives (never prefill the key).
  useEffect(() => {
    if (store) {
      setProvider(store.llmProvider ?? "openai");
      setBaseUrl(store.llmBaseUrl ?? "");
      setModel(store.llmModel ?? "");
      setVisionOn(!!store.visionEnabled);
    }
  }, [store]);

  const onProviderChange = (value: string) => {
    setProvider(value);
    // Keep the model sensible when switching providers.
    if (value === "anthropic" && !model.startsWith("claude")) setModel("claude-opus-4-8");
    if (value === "openai" && model.startsWith("claude")) setModel("");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const values: Record<string, any> = {
      id: store.id,
      llmProvider: provider,
      llmBaseUrl: baseUrl.trim(),
      llmModel: model.trim(),
      visionEnabled: visionOn,
    };
    if (apiKey.trim()) values.llmApiKey = apiKey.trim();
    const result = await updateStore(values as any);
    if (!result.error) {
      setSaved(true);
      setApiKey("");
    }
  };

  if (loading && !store) {
    return <Panel header="Chatbot LLM settings"><Text color="secondary60">Loading…</Text></Panel>;
  }
  if (!store) return null;

  return (
    <Panel header="Chatbot LLM settings" description="Configure the AI model that powers the storefront chatbot for this store.">
      <Form onSubmit={onSubmit}>
        <FormGroup>
          <Select
            label="Provider"
            name="provider"
            options={[
              { value: "openai", content: "OpenAI-compatible (Ollama, vLLM, llama.cpp, LM Studio…)" },
              { value: "anthropic", content: "Anthropic (Claude)" },
            ]}
            value={provider}
            onOptionChange={(value) => onProviderChange(value as string)}
            required
          />
        </FormGroup>

        {provider === "anthropic" ? (
          <FormGroup>
            <Select
              label="Model"
              name="model"
              description="Which Claude model powers the chatbot."
              options={CLAUDE_MODELS}
              value={CLAUDE_MODELS.some((m) => m.value === model) ? model : "claude-opus-4-8"}
              onOptionChange={(value) => setModel(value as string)}
              required
            />
          </FormGroup>
        ) : (
          <>
            <FormGroup>
              <Input
                label="API base URL"
                description="For OpenAI-compatible providers, e.g. https://ai.pcsoftnepal.com/v1"
                value={baseUrl}
                placeholder="https://.../v1"
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </FormGroup>
            <FormGroup>
              <Input
                label="Model"
                value={model}
                placeholder="pcsoftai"
                onChange={(e) => setModel(e.target.value)}
              />
            </FormGroup>
          </>
        )}
        <FormGroup>
          <Input
            label="API key"
            type="password"
            description={provider === "anthropic" ? "Your Anthropic API key (sk-ant-…)" : "Your provider's API key (leave blank if not required)."}
            value={apiKey}
            placeholder={store.llmApiKey ? "•••••••• (leave blank to keep current)" : "Enter API key"}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </FormGroup>

        <FormGroup>
          <Checkbox
            label="Enable image uploads (vision)"
            description={provider === "anthropic" ? "All Claude models support images." : "Only enable if your model supports vision/images."}
            checked={visionOn}
            onChange={() => setVisionOn((v) => !v)}
          />
        </FormGroup>

        {saveError && <Message type="error" messages={[{ text: saveError.message }]} marginVertical="medium" />}
        {saved && <Message type="success" messages={[{ text: "Settings saved." }]} marginVertical="medium" />}

        <Button type="submit" isLoading={saving}>Save settings</Button>
      </Form>
    </Panel>
  );
}
