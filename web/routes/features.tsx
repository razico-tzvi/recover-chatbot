import { Fragment } from "react";
import { FEATURES } from "../../api/lib/defaults";
import { useSettings, type Draft } from "../lib/settings";
import { Card, Loading, Switch, Tag } from "../components/ui";

const GROUPS = [...new Set(FEATURES.map((f) => f.group))];

export const FeaturesPage = () => {
  const { draft, set, loading } = useSettings();
  if (loading || !draft) return <Loading />;
  const d = draft as Draft;
  const toggle = (key: string) => set("features", { ...d.features, [key]: !d.features[key as keyof typeof d.features] });

  return (
    <>
      <Card title="Features" sub="Off removes the tool from the model's tool list at the API level — it is never just a prompt instruction.">
        {GROUPS.map((group) => (
          <Fragment key={group}>
            <div className="ghead">{group}</div>
            {FEATURES.filter((f) => f.group === group).map((f) => (
              <div key={f.key} className="frow">
                <div className="name">
                  {f.label}{" "}
                  {f.needs && <span className="desc">needs {f.needs}</span>}
                  {f.tools.length > 0 && <div className="desc mono">{f.tools.join(", ")}</div>}
                </div>
                {f.comingSoon && <Tag>Coming soon</Tag>}
                <Switch
                  label={f.label}
                  checked={!!d.features[f.key as keyof typeof d.features]}
                  disabled={!!f.comingSoon}
                  onChange={() => toggle(f.key)}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </Card>
      <Card
        title="Closing incentive settings"
        sub="Unique single-use code via the BigCommerce Promotions API, offered once on an express price objection."
      >
        <p className="hint" style={{ marginTop: 0 }}>
          Discount, code expiry, minimum cart value, per-shopper cooldown, global daily cap and the A/B split get configured here when the closing incentive ships.
        </p>
      </Card>
    </>
  );
};
