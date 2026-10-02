NoPixel Territory map
====
Mapa público de solo lectura de territorios y puntos de interés de Infames en NoPixel.
El sitio carga datos desde los JSON del repositorio y no puede modificarlos.

## Propose a location
The map is read-only. To propose a change, update the appropriate JSON file under `data/`
and submit a pull request.

## How to host yourself

1. Clone this repository
2. Host the repository using Nginx, Apache, or another webserver.

To host the repository using Python 3 from the root of the repository:
```
python -m http.server 8000
```

If you are on Windows and Python is installed, you can run:
```
python.exe -m http.server 8000
```

Or use the included helper script:
```
.\start-local.ps1
```

## Supabase admin setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Create the admin user in Authentication > Users.
4. Copy the user UUID and insert it into `public.zone_admins`:
   ```sql
   insert into public.zone_admins (user_id)
   values ('USER-UUID');
   ```
5. Set the project URL and publishable key in the `window.SUPABASE_CONFIG` block in `index.html`.

## Publish with GitHub Pages
1. Push this project to the `main` branch of your GitHub repository.
2. In **Settings > Pages**, set the build source to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the site after each push to `main`.

## Configure password-protected editing
1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor.
2. Create the administrator account under **Authentication > Users** with an email and password.
3. Copy that user's UUID and authorize only that account in the SQL Editor:
	```sql
	insert into public.zone_admins (user_id) values ('USER-UUID');
	```
4. Set the project URL and publishable key in the `window.SUPABASE_CONFIG` block in `index.html`, then push to `main`. The publishable key is safe in the browser because RLS protects writes; never add a service-role key or password to the repository.
5. Use **Acceso admin** on the map to sign in. Everyone else can read zones but cannot create, edit, or delete them.

## License

[WTFPL](LICENSE)

## Version

1.1.0

## Credits

To [danharper](https://github.com/danharper/) for [his work](https://github.com/danharper/GTAV) on the GTA V map.
To [gta5-map](https://github.com/gta5-map) for [their work](https://github.com/gta5-map/gta5-map.github.io) on the GTA V map.

## Star History

By starring this repository you attract contributors to invest time into maintaing it.

[![Star History Chart](https://api.star-history.com/svg?repos=skyrossm/np-gangmap&type=Date)](https://star-history.com/#skyrossm/np-gangmap)

## Screenshots

![screenshot-1](https://i.imgur.com/VavAdiG.jpg)
![screenshot-2](https://i.imgur.com/978UDPW.jpg)
![screenshot-3](https://i.imgur.com/ijtZIHO.jpg)
![screenshot-4](https://i.imgur.com/VMuDSrK.png)
