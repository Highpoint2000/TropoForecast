# TropoForecast
Local and regional tropo forecast for FMDX web server

<img width="1755" height="853" alt="grafik" src="https://github.com/user-attachments/assets/f816a42f-64b6-4750-8e01-459ec80c9758" />

## Version 1.1

- Increased map brightness and contrast
- Added Tropo Index display to the button

## Important note
This plugin provides a very reliable trend and probabilities for Tropo DX. However, due to purely technical reasons (resolution of global weather models), a 100% guarantee of forecast reliability cannot be given. It is still recommended to consult forecasts such as Hepburn.

## Installation notes

1. [Download](https://github.com/Highpoint2000/TropoForecast/releases) the last repository as a zip
2. Unpack all files from the plugins folder to ..fm-dx-webserver-main\plugins\ 
3. Stop or close the fm-dx-webserver
4. Start/Restart the fm-dx-webserver with "npm run webserver" on node.js console, check the console informations
5. Activate the TropoForecast plugin in the settings
6. Stop or close the fm-dx-webserver
7. Start/Restart the fm-dx-webserver with "npm run webserver", check the console informations on node.js console

## Contact

If you have any questions, would like to report problems, or have suggestions for improvement, please feel free to contact me! You can reach me by email at highpoint2000@googlemail.com. I look forward to hearing from you!

<a href="https://www.buymeacoffee.com/Highpoint" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

<details>
<summary>History</summary>

### Version 1.0

- Uses vertical refractive profiles (N according to ITU logic via temperature, humidity, and pressure)
- Considers pressure levels (1000–850 hPa) with elevation gradients
- Searches for strongly superrefractive gradients (threshold ~ −60 N/km instead of just "something below −39 N/km")
- Additionally considers wind shear in the layer with the strongest gradient, including conversion of direction/speed to u/v components
- Cleanly scales the result to a 0–10 index (based on Hepburn)
