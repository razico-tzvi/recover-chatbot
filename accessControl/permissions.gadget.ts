import type { GadgetPermissions } from "gadget-server";

/**
 * This metadata describes the access control configuration available in your application.
 * Grants that are not defined here are set to false by default.
 *
 * View and edit your roles and permissions in the Gadget editor at https://recover-ai-chat.gadget.app/edit/settings/permissions
 */
export const permissions: GadgetPermissions = {
  type: "gadget/permissions/v1",
  roles: {
    "bigcommerce-app-users": {
      storageKey: "Role-BigCommerce-App",
      models: {
        "bigcommerce/store": {
          read: {
            filter: "accessControl/filters/bigcommerce/store.gelly",
          },
          actions: {
            install: true,
            reinstall: true,
            removeUser: true,
            uninstall: true,
            update: {
              filter: "accessControl/filters/bigcommerce/store.gelly",
            },
          },
        },
        chatMessage: {
          read: {
            filter: "accessControl/filters/chatMessage.gelly",
          },
          actions: {
            delete: {
              filter: "accessControl/filters/chatMessage.gelly",
            },
          },
        },
        chatSession: {
          read: {
            filter: "accessControl/filters/chatSession.gelly",
          },
          actions: {
            delete: {
              filter: "accessControl/filters/chatSession.gelly",
            },
            update: {
              filter: "accessControl/filters/chatSession.gelly",
            },
          },
        },
      },
    },
    unauthenticated: {
      storageKey: "unauthenticated",
    },
  },
};
