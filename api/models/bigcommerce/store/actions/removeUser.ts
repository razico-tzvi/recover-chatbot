import { applyParams, save, ActionOptions } from "gadget-server";

// Powers the form in the 'change password' page

export const run: ActionRun = async ({ params, record, logger, api, connections }) => {
  applyParams(params, record);
  await save(record);

  // Delete all sessions for the user of this store
  const bigcommerceSID = `${record.storeHash}-${params.bigcommerceUserId}`;
  await api.internal.session.deleteMany({ filter: { bigcommerceSID: { equals: bigcommerceSID } } });
};

export const onSuccess: ActionOnSuccess = async ({ params, record, logger, api, connections }) => {
  // Your logic goes here
};

export const options: ActionOptions = {
  actionType: "update",
};
