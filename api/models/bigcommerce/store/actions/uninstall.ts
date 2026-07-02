import { applyParams, save, ActionOptions } from "gadget-server";

// Powers the form in the 'change password' page

export const run: ActionRun = async ({ params, record, logger, api, connections }) => {
  applyParams(params, record);
  await save(record);

  // Delete all session records for the associated store
  await api.internal.session.deleteMany({ filter: { bigcommerceStoreId: { equals: record.id } } });
};

export const onSuccess: ActionOnSuccess = async ({ params, record, logger, api, connections }) => {
  // Your logic goes here
};

export const options: ActionOptions = {
  actionType: "update",
};
