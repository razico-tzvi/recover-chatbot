import { Badge, Box, Flex, Panel, Switch, Text } from "@bigcommerce/big-design";
import { FEATURES } from "../../api/lib/defaults";
import { useSettings, type Draft } from "../lib/settings";

const GROUPS = [...new Set(FEATURES.map((f) => f.group))];

export const FeaturesPage = () => {
  const { draft, set, loading } = useSettings();
  if (loading || !draft) return <Panel><Text color="secondary60">Loading…</Text></Panel>;
  const d = draft as Draft;
  const toggle = (key: string) => set("features", { ...d.features, [key]: !d.features[key as keyof typeof d.features] });

  return (
    <Panel
      header="Features"
      description="Turning a feature off removes its tools from the model's tool list at the API level — it is never just a prompt instruction."
    >
      {GROUPS.map((group) => (
        <Box key={group} marginBottom="large">
          <Text bold>{group}</Text>
          {FEATURES.filter((f) => f.group === group).map((f) => (
            <Flex key={f.key} justifyContent="space-between" alignItems="center" padding="xSmall" borderBottom="box">
              <Box>
                <Flex flexGap="8px" alignItems="center">
                  <Text marginBottom="none">{f.label}</Text>
                  {f.needs && <Badge variant="warning" label={`Needs ${f.needs}`} />}
                  {f.comingSoon && <Badge variant="secondary" label="Coming soon" />}
                </Flex>
                {f.tools.length > 0 && (
                  <Text color="secondary60" marginBottom="none">{f.tools.join(", ")}</Text>
                )}
              </Box>
              <Switch
                checked={!!d.features[f.key as keyof typeof d.features]}
                disabled={!!f.comingSoon}
                onChange={() => toggle(f.key)}
              />
            </Flex>
          ))}
        </Box>
      ))}
      <Text color="secondary60">
        Closing incentive (a single-use discount code, offered only on an express price objection, with A/B testing and abuse caps) gets its settings panel here when it ships.
      </Text>
    </Panel>
  );
};
