# RISKS.md — Riesgos técnicos

- **Seguridad multi-tenant**: reglas de Firestore mal configuradas podrían filtrar datos entre usuarios o grupos. Mitigación: probar las reglas con el emulador de Firebase antes de cada deploy, no solo confiar en la lógica del frontend.
- **Neteo de deudas**: el algoritmo de simplificación de balances (quién le debe a quién) puede tener edge cases con ciclos de deuda (A→B→C→A). Mitigación: cubrir con tests unitarios desde la Fase 4.
- **Invitación por email**: resolver email → uid sin exponer la lista completa de usuarios registrados. Mitigación: Cloud Function callable, nunca una query directa desde el cliente.
- **Costo de Firebase Blaze**: Cloud Functions programadas + lecturas de Firestore pueden crecer con más usuarios/grupos activos. Mitigación: monitorear cuotas desde el inicio, igual que se hizo con el gym app.
- **Cálculo de balance en tiempo real**: si un grupo crece mucho (muchos movimientos), calcular el balance en el cliente en cada lectura puede volverse lento. Mitigación: si se vuelve un problema, mover el cálculo a una Cloud Function que mantenga un documento de balance cacheado por grupo.
