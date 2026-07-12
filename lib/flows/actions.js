'use strict';

exports.init = async function (homey) {
  const action_SET_PV_SURPLUS_INFO = homey.flow.getActionCard('set_pv_surplus_info');
  action_SET_PV_SURPLUS_INFO.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_PV_SURPLUS_INFO({ pGrid: args.pGrid, pPv: args.pPv, pAkku: args.pAkku });
  });

  const action_SET_CHARGER_MODE = homey.flow.getActionCard('set_charger_mode');
  action_SET_CHARGER_MODE.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_CHARGER_MODE(args.mode);
  });

  const action_SET_TRANSACTION = homey.flow.getActionCard('set_transaction');
  action_SET_TRANSACTION.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_TRANSACTION(args.transaction);
  });

  const action_SET_FLEXIBLE_RATE_LIMIT = homey.flow.getActionCard('set_flexible_rate_limit');
  action_SET_FLEXIBLE_RATE_LIMIT.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_FLEXIBLE_RATE_LIMIT(args.rate);
  });

  const action_SET_DAILY_TRIP_KWH_TARGET = homey.flow.getActionCard('set_daily_trip_kWh_target');
  action_SET_DAILY_TRIP_KWH_TARGET.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_DAILY_TRIP_KWH_TARGET({
      targetEnergyKWh: args.target_energy,
      targetTime: args.target_time
    });
  });

  const action_SET_DAILY_TRIP_PCT_TARGET = homey.flow.getActionCard('set_daily_trip_pct_target');
  action_SET_DAILY_TRIP_PCT_TARGET.registerRunListener(async (args, state) => {
    await args.device.onCapability_SET_DAILY_TRIP_PCT_TARGET({
      startSoc: args.start_soc,
      targetSoc: args.target_soc,
      batteryCapacityKWh: args.bat_kWh,
      targetTime: args.target_time
    });
  });

  const condition_IS_CHARGER_MODE = homey.flow.getConditionCard('is_charger_mode');
  condition_IS_CHARGER_MODE.registerRunListener(async (args, state) => args.device.getCapabilityValue('goe_charger_mode') === args.mode);
};
