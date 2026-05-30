'use strict';

exports.init = async function (homey) {
  const action_SET_PV_SURPLUS_INFO = homey.flow.getActionCard('set_pv_surplus_info');
  action_SET_PV_SURPLUS_INFO.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_PV_SURPLUS_INFO({pGrid: args.pGrid, pPv: args.pPv, pAkku: args.pAkku});
  });

  const action_SET_PV_SURPLUS_ENABLED = homey.flow.getActionCard('set_pv_surplus_enabled');
  action_SET_PV_SURPLUS_ENABLED.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_PV_SURPLUS_ENABLED(args.enabled);
  });
};
