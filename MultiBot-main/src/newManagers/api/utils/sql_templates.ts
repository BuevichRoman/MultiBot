/**
 * SQL template query helpers for driver search (cities by location, drivers by city).
 * Migrated from old api/sql_templates.ts into new architecture.
 */
import axios from 'axios';
import * as geoTz from 'geo-tz';
import { DateTime } from 'luxon';
import type { AuthData } from './general';
import { postHeaders } from './general';
import { getTaggedLogger } from '../../../addons/logger';

const sqlTplLog = getTaggedLogger('sql_templates');

export async function getCitiesByDriveStartLoc(
    adminAuth: AuthData,
    baseURL: string,
    geo: { latitude: number; longitude: number },
): Promise<{
    status: string;
    data?: Array<{ id_city: string; [key: string]: string | number }>;
}> {
    const authForForm = { token: adminAuth.token, hash: adminAuth.hash };
    const form = new FormData();
    form.append('token', authForForm.token);
    form.append('u_hash', authForForm.hash);
    form.append('data', JSON.stringify({
        ':drive_latitude': geo.latitude.toString(),
        ':drive_longitude': geo.longitude.toString(),
        ':max_distance': 100,
    }));

    const response = await axios.post(`${baseURL}/query/template/1`, form, {
        headers: postHeaders,
    });
    return response.data;
}

export async function getDriversForCity(
    adminAuth: AuthData,
    baseURL: string,
    city_id_list: string[],
): Promise<{
    status: string;
    code: string;
    data?: Array<{ id_user: string; phone: string; name: string; [key: string]: unknown }>;
}> {
    const form = new FormData();
    form.append('token', adminAuth.token);
    form.append('u_hash', adminAuth.hash);
    form.append('data', JSON.stringify({
        ':city_id_list': city_id_list.join(','),
    }));

    const response = await axios.post(`${baseURL}/query/template/2`, form, {
        headers: postHeaders,
    });
    return response.data;
}

export async function getDriversForCityNight(
    adminAuth: AuthData,
    baseURL: string,
    city_id_list: string[],
    client_id: string,
): Promise<{
    status: string;
    data?: Array<{ id_user: string; phone: string; name: string; [key: string]: unknown }>;
}> {
    const form = new FormData();
    form.append('token', adminAuth.token);
    form.append('u_hash', adminAuth.hash);
    form.append('data', JSON.stringify({
        ':city_id_list': city_id_list.join(','),
        ':client_id': client_id,
    }));

    const response = await axios.post(`${baseURL}/query/template/3`, form, {
        headers: postHeaders,
    });
    return response.data;
}

export async function isNightTime(lat: number, lng: number): Promise<boolean> {
    try {
        const timezones = geoTz.find(lat, lng);
        if (!timezones.length) return false;
        const localTime = DateTime.now().setZone(timezones[0]);
        const currentHour = localTime.hour;
        return currentHour >= 22 || currentHour < 6;
    } catch (error) {
        sqlTplLog.error('Error determining night time', { lat, lng, error });
        return false;
    }
}
