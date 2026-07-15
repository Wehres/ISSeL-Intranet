# I.S.Se.L. QM-Intranet

Das veröffentlichte Intranet befindet sich im Ordner `web`. Es wird als statische GitHub-Pages-Anwendung bereitgestellt und nutzt Firebase Authentication sowie Cloud Firestore.

## Sicherheitsmodell

- Die Dokumentdateien bleiben als gelenkte Originale in OneDrive oder SharePoint. In Firestore liegen nur Dokumentinformationen und der jeweils freigegebene HTTPS-Link.
- Der GitHub-Pages-Code enthält keine Dokumentdaten und keine Downloadlinks.
- Beim ersten Login erhält ein in Firebase angelegter Benutzer automatisch ein aktives Leserprofil mit Zugriff auf alle QM-Bereiche. Der hinterlegte erste Administrator wird beim ersten Login automatisch als `admin` angelegt. Ein Leserprofil enthält `displayName` (Text), `active` (Boolean `true`), `roles` (Array: `reader`) und `areas` (Array: `all`).
- Security- und K9-Inhalte liegen getrennt in `areas/security` bzw. `areas/k9`; Verbundinhalte in `areas/shared`.

## Ersteinrichtung

1. In Firebase Authentication die gewünschten Benutzer anlegen. Beim ersten Login wird das Leserprofil automatisch erzeugt (nur für Konten mit `…@isselgroup.com`; andere Konten gibt der Administrator über ein manuell angelegtes `users/{UID}`-Dokument frei).
2. Die Regeln aus `firebase/firestore.rules` in Firebase unter **Firestore → Regeln** einfügen und **veröffentlichen**. Nach jeder Änderung an der Regeldatei muss dieser Schritt wiederholt werden.
3. In Firebase unter **Authentication → Einstellungen → Nutzeraktionen** die Option **Erstellen (Registrieren)** deaktivieren, damit keine fremden Konten über die öffentliche Firebase-Schnittstelle angelegt werden können.
4. Für die Pflege bzw. den erstmaligen Datenimport ist ein Administrationskonto vorgesehen. Dieses Konto erhält die Rolle `admin` und den Bereich `all`; es ist nicht mit der QM-Rolle QMB gleichzusetzen.
5. Lokal einmal `npm install` ausführen, dann `npm run seed:build` (benötigt die lokale Datei `data.js` aus dem QM-Intranet-Ordner).
6. Die Daten mit dem Administrationskonto importieren: `QM_ADMIN_EMAIL="…"`, `QM_ADMIN_PASSWORD="…"`, dann `npm run seed:import -- --apply`. Ohne diesen Import ist die Datenbank leer und das Intranet zeigt nach der Anmeldung „Es sind noch keine QM-Prozesse im Datenbestand hinterlegt.“
7. In Firestore bei allen Dokumenten die `href`-Felder mit den organisationsinternen OneDrive- oder SharePoint-Links ergänzen. Lokale Pfade funktionieren online nicht.
8. In Firebase Authentication unter „Authorized domains“ die GitHub-Pages-Domain `wehres.github.io` hinterlegen.

## Fehlerdiagnose bei Anmeldeproblemen

- Unter dem Anmeldebutton steht die Versionsnummer und der Hostname. Dort muss `wehres.github.io` stehen; steht dort „lokale Datei“, wurde die falsche Adresse geöffnet.
- Die Seite <https://wehres.github.io/ISSeL-Intranet/diagnose.html> prüft ohne Anmeldedaten, ob der Browser die Firebase-Dienste erreicht. Schlägt dort eine Prüfung fehl, blockiert der Firmen-Proxy, ein Virenscanner oder eine Firewall die markierte Verbindung — das Ergebnis kann kopiert und an die IT weitergegeben werden.
- Die Anmeldung versucht jeden Firebase-Aufruf automatisch ein zweites Mal und meldet spätestens nach etwa 25 Sekunden einen konkreten Fehler; ein endloses „Anmeldung läuft …“ tritt nicht mehr auf.

## Veröffentlichung

In GitHub unter **Settings → Pages** als Quelle **GitHub Actions** auswählen. Jeder Push auf `main` stellt den Ordner `web` bereit.

## Audit-Hinweis

Die Anwendung ist eine Zugriffsschicht. Der Freigabestatus, die Version und der Änderungsverlauf im jeweiligen QM-Originaldokument bleiben verbindlich. Rollen, Dokumentlinks und Firestore-Regeln sind vor der produktiven Freigabe durch QMB und GF zu prüfen.
