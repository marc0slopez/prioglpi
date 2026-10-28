import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSyncStatus } from '@/lib/sync-service';
import { GlpiClient } from '@/lib/glpi-client';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    // Test de conexión GLPI
    let glpiConnected = false;
    let glpiError: string | null = null;

    try {
      const client = new GlpiClient();
      await client.initSession();
      glpiConnected = true;
      await client.killSession();
    } catch (err) {
      glpiError = err instanceof Error ? err.message : String(err);
    }

    // Estado de sync
    const syncStatus = await getSyncStatus();

    return NextResponse.json({
      status: 'ok',
      glpi: {
        connected: glpiConnected,
        error: glpiError,
        baseUrl: process.env.GLPI_BASE_URL?.replace(/\/apirest\.php$/, '') || '',
      },
      sync: syncStatus,
    });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      { status: 'error', error: 'Error interno.' },
      { status: 500 }
    );
  }
}
