# com.go-e

Charge your electric car at a low cost and intelligently. Support for the Go-e Home+ (V3), Gemini, CORE, and PRO models of EV chargers.

This Homey app is developed independently by Complus Ky with support from go-e GmbH. For support and inquiries, please contact the developer directly.

## FAQ

### PV Surplus Charging

#### Recommended settings

- Starting power level: 1,4 kW
- Power preference: Default or Prefer power to grid
Grid target value: 0 W or, for example, -200 W (if there is battery not measured by the go-e controller or pAkku isn’t being sent)
- Phase switching: Automatic
- 3-phase power level: 4,2 kW

#### There are scenarios where the charger deliberately draws power from the grid

This happens, for example, immediately after charging begins → in this case, the charger (provided there was sufficient surplus power beforehand) continues charging for at least five minutes, even if the surplus suddenly drops.
In addition, the go-e Charger always starts the charging process with the same number of phases as the previous charging process ended with.

The second scenario would be an upcoming phase switch. Here, the Charger checks for two minutes to see if the surplus has changed after all—if this is still not the case after two minutes, a phase switch is performed. During these two minutes, however, power is drawn from the grid (albeit as little as possible).

The third scenario occurs immediately after a phase switch. Once a phase switch has taken place, it is blocked for ten minutes.
