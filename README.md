# I.S.Se.L. QM-Intranet

Das veröffentlichte Intranet befindet sich im Ordner `web`. Es wird als statische GitHub-Pages-Anwendung bereitgestellt und nutzt Firebase Authentication sowie Cloud Firestore.

## Sicherheitsmodell

- Die Dokumentdateien bleiben als gelenkte Originale in OneDrive oder SharePoint. In Firestore liegen nur Dokumentinformationen und der jeweils freigegebene HTTPS-Link.
- Der GitHub-Pages-Code enthält keine Dokumentdaten und keine Downloadlinks.
- Beim ersten Login erhält ein in Firebase angelegter Benutzer automatisch ein aktives Leserprofil mit Zugriff auf alle QM-Bereiche. Der hinterlegte erste Administrator wird beim ersten Login automatisch als `admin` angelegt. Ein Leserprofil enthält `displayName` (Text), `active` (Boolean `true`), `roles` (Array: `reader`) und `areas` (Array: `all`).
- Security- und K9-Inhalte liegen getrennt in `areas/security` bzw. `areas/k9`; Verbundinhalte in `areas/shared`.

## Ersteinrichtung

1. In Firebase Authentication die gewünschten Benutzer anlegen. Beim ersten Login wird das Leserprofil automatisch erzeugt.
2. Die Regeln aus `firebase/firestore.rules` bereitstellen.
3. Für die Pflege bzw. den erstmaligen Datenimport ist ein Administrationskonto vorgesehen. Dieses Konto erhält die Rolle `admin` und den Bereich `all`; es ist nicht mit der QM-Rolle QMB gleichzusetzen.
4. Lokal einmal `npm install` ausführen, dann `npm run seed:build`.
5. Die Daten mit dem Administrationskonto importieren: `QM_ADMIN_EMAIL="…"`, `QM_ADMIN_PASSWORD="…"`, dann `npm run seed:import -- --apply`.
6. In Firestore bei allen Dokumenten die `href`-Felder mit den organisationsinternen OneDrive- oder SharePoint-Links ergänzen. Lokale Pfade funktionieren online nicht.
7. In Firebase Authentication unter „Authorized domains“ die GitHub-Pages-Domain `wehres.github.io` hinterlegen.

## Veröffentlichung

In GitHub unter **Settings → Pages** als Quelle **GitHub Actions** auswählen. Jeder Push auf `main` stellt den Ordner `web` bereit.

## Audit-Hinweis

Die Anwendung ist eine Zugriffsschicht. Der Freigabestatus, die Version und der Änderungsverlauf im jeweiligen QM-Originaldokument bleiben verbindlich. Rollen, Dokumentlinks und Firestore-Regeln sind vor der produktiven Freigabe durch QMB und GF zu prüfen.
