# TropoForecast
Local and regional tropo forecast for FMDX web server

### This forecast is based on my own calculations and—aside from its color scheme and visual design—bears no resemblance to William R. Hepburn's forecast!

<img width="1670" height="844" alt="Tropo" src="https://github.com/user-attachments/assets/52741619-901a-46d0-aa73-fd371a5ec012" />


## Version 2.0b

- Switched the Open-Meteo API query from best_match to icon_eu to ensure the model provides sufficient geographical coverage for the 500km radius, eliminating edge-clamping and duplicate horizontal/vertical data bands
- Replaced the standard Hepburn-style rainbow colors with a custom, highly visible thermal color scale. This provides far better contrast against the dark base map, especially for lower-level values
- Overhauled the legend labels to use practical signal propagation terms instead of generic weather qualities

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

### Version 2.0a

- Reduce server-side CPU usage spikes

Many thanks to AmateurAudioDude for this code improvements!

### Version 2.0

- New Client-Server Architecture: Moved all data fetching from the browser directly to a dedicated backend module (TropoForecast_server.js) using WebSockets.  
- Massive API Optimization & Caching: The server now handles the heavy lifting, requesting the 500km grid once and caching it server-side for 3 hours. This effectively prevents browser CORS errors and API rate-limit bans.  
- Simplified Loading Logic: Removed the complex, two-phase loading process. The system now performs a single, stable data request.  
– Minor changes to the UI & styling

### Version 1.2

- API error 429 was fixed by querying the Open Meteo API once
- 100 km zoom level added
- Minor design adjustments

### Version 1.1a

- Location queries are now performed using the stored formats; queries via the browser are now only a fallback option


### Version 1.1

- Increased map brightness and contrast
- Added Tropo Index display to the button

### Version 1.0

- Uses vertical refractive profiles (N according to ITU logic via temperature, humidity, and pressure)
- Considers pressure levels (1000–850 hPa) with elevation gradients
- Searches for strongly superrefractive gradients (threshold ~ −60 N/km instead of just "something below −39 N/km")
- Additionally considers wind shear in the layer with the strongest gradient, including conversion of direction/speed to u/v components
- Cleanly scales the result to a 0–10 index (based on Hepburn)
