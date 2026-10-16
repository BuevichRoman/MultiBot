<?php
/**
 * explain_match — диагностика, почему конкретный заказ не виден водителю.
 *
 * Установка: создать script_template с var=explain_match через API под администратором.
 * Вызов: POST /api/v1/script/template/explain_match?is_var=1
 * s_t_data: {"driver_id":123,"order_id":456}
 *
 * Шаблон только читает данные. Он воспроизводит фильтры selectProcessingOrder
 * для одного водителя и одного заказа, не изменяя назначение или состояние заказа.
 */

if (!function_exists('explain_match_add_check')) {
    function explain_match_add_check(&$checks, $name, $status, $reason, $details)
    {
        $checks[] = array(
            'name' => $name,
            'status' => $status,
            'reason_code' => $reason,
            'details' => $details
        );
    }
}

if (!function_exists('explain_match_ids')) {
    function explain_match_ids($value)
    {
        if ($value === NULL || $value === '') return array();
        $parts = is_array($value) ? $value : explode(',', (string)$value);
        $ids = array();
        foreach ($parts as $part) {
            $part = trim((string)$part);
            if ($part !== '' && ctype_digit($part)) $ids[] = (int)$part;
        }
        return array_values(array_unique($ids));
    }
}

if (!function_exists('explain_match_requirements_satisfied')) {
    /**
     * Every option required by the order must be present on the driver.
     * Empty order requirements do not restrict matching; an empty driver list
     * cannot satisfy a non-empty order list.
     */
    function explain_match_requirements_satisfied($driverValues, $orderRequirements)
    {
        $required = explain_match_ids($orderRequirements);
        if (count($required) === 0) return true;
        $available = explain_match_ids($driverValues);
        foreach ($required as $id) {
            if (!in_array($id, $available, true)) return false;
        }
        return true;
    }
}

if (!function_exists('explain_match_deadline_satisfied')) {
    function explain_match_deadline_satisfied($secondsRemaining)
    {
        return is_numeric($secondsRemaining) && (float)$secondsRemaining > 0;
    }
}

if (!function_exists('explain_match_arrival_satisfied')) {
    function explain_match_arrival_satisfied($distanceMeters, $secondsRemaining, $averageSpeedKmh)
    {
        if (!is_numeric($distanceMeters) || !is_numeric($secondsRemaining) ||
            !is_numeric($averageSpeedKmh) || (float)$secondsRemaining <= 0 ||
            (float)$averageSpeedKmh <= 0) return false;
        return (float)$distanceMeters <= ((float)$secondsRemaining * (float)$averageSpeedKmh / 3.6);
    }
}

if (!function_exists('explain_match_haversine_m')) {
    function explain_match_haversine_m($lat1, $lng1, $lat2, $lng2)
    {
        $r = 6371000;
        $a = pow(sin(deg2rad(((float)$lat2 - (float)$lat1) / 2)), 2) +
            cos(deg2rad((float)$lat1)) * cos(deg2rad((float)$lat2)) *
            pow(sin(deg2rad(((float)$lng2 - (float)$lng1) / 2)), 2);
        return 2 * $r * asin(sqrt(min(1, max(0, $a))));
    }
}

if (defined('EXPLAIN_MATCH_TEST_MODE')) return;

call_user_func(function () {
    $api = $this;
    $in = isset($_REQUEST['s_t_data']) ? $_REQUEST['s_t_data'] : '';
    $in = is_array($in) ? $in : json_decode($in, true);
    if (!is_array($in)) json_exit('404', 'error', 'wrong s_t_data', null);

    $driverIdRaw = isset($in['driver_id']) ? trim((string)$in['driver_id']) : '';
    $orderIdRaw = isset($in['order_id']) ? trim((string)$in['order_id']) : '';
    if ($driverIdRaw === '' || !ctype_digit($driverIdRaw) || (int)$driverIdRaw < 1 ||
        $orderIdRaw === '' || !ctype_digit($orderIdRaw) || (int)$orderIdRaw < 1) {
        json_exit('404', 'error', 'driver_id and order_id must be positive integers', null);
    }

    if (empty($_SESSION[UID]) || (int)$api->id_role !== 4) {
        json_exit('403', 'error', 'admin access required', null);
    }

    $driverId = (int)$driverIdRaw;
    $orderId = (int)$orderIdRaw;
    $checks = array();

    // Read the same driver attributes used by selectProcessingOrder($filter).
    $driverSql = "
        SELECT
            u.id_user,
            u.id_role,
            ul.lat,
            ul.lng,
            c.id_car,
            c.id_car_class,
            (SELECT GROUP_CONCAT(uoc.id_order_comment SEPARATOR ',')
               FROM users_order_comment uoc
              WHERE uoc.id_user = u.id_user) AS driver_comments,
            (SELECT GROUP_CONCAT(us.id_service SEPARATOR ',')
               FROM users_service us
              WHERE us.id_user = u.id_user) AS driver_services,
            (SELECT GROUP_CONCAT(uol.id_order_location SEPARATOR ',')
               FROM users_order_location uol
              WHERE uol.id_user = u.id_user) AS driver_location_classes
        FROM users u
        LEFT JOIN users_location ul
               ON ul.id_user = u.id_user AND ul.service = 1
        LEFT JOIN car_users cu
               ON cu.id_user = u.id_user AND cu.used = '1'
        LEFT JOIN car c ON c.id_car = cu.id_car
        WHERE u.id_user = " . $driverId . "
        LIMIT 1";
    $driverResult = query($driverSql);
    if ($driverResult === false) json_exit('500', 'error', 'driver query failed', null);
    $driver = fetch_assoc($driverResult);
    if (empty($driver['id_user'])) {
        explain_match_add_check($checks, 'driver_exists', 'fail', 'DRIVER_NOT_FOUND', 'Водитель не найден.');
        json_exit('200', 'success', null, array(
            'driver_id' => $driverId, 'order_id' => $orderId,
            'can_see_order' => false, 'decision' => 'not_visible', 'checks' => $checks
        ));
    }

    explain_match_add_check($checks, 'driver_role',
        (int)$driver['id_role'] === 2 ? 'pass' : 'fail',
        (int)$driver['id_role'] === 2 ? null : 'USER_IS_NOT_DRIVER',
        'id_role=' . $driver['id_role'] . '; production selector требует роль водителя (2).');

    explain_match_add_check($checks, 'used_car',
        !empty($driver['id_car']) ? 'pass' : 'fail',
        !empty($driver['id_car']) ? null : 'USED_CAR_NOT_FOUND',
        !empty($driver['id_car']) ? 'Используемый автомобиль найден.' : 'Не найден автомобиль с car_users.used=1.');

    if (empty($driver['driver_location_classes'])) {
        explain_match_add_check($checks, 'driver_location_classes', 'fail',
            'DRIVER_LOCATION_CLASSES_EMPTY',
            'В production selector пустой список users_order_location приводит к отказу.');
    }

    // The selector calculates the distance in SQL, using MySQL NOW() for the
    // remaining time and the configured average_speed in km/h.
    $hasDriverCoordinates = isset($driver['lat']) && $driver['lat'] !== '' &&
        isset($driver['lng']) && $driver['lng'] !== '';
    $lat = $hasDriverCoordinates ? (float)$driver['lat'] : 0;
    $lng = $hasDriverCoordinates ? (float)$driver['lng'] : 0;
    $distanceSql = 'NULL AS backend_distance_m';
    if ($hasDriverCoordinates) {
        $distanceSql = "
            2*6371000*ASIN(SQRT(
                POW(SIN(PI()/360*(o.from_lat - " . $lat . ")),2) +
                COS(PI()/360*" . $lat . ")*COS(PI()/360*o.from_lat)*
                POW(SIN(PI()/360*(o.from_lng - " . $lng . ")),2)
            )) AS backend_distance_m";
    }

    $orderSql = "
        SELECT
            o.id_order,
            o.client,
            o.id_order_status,
            o.kind,
            o.max_waiting_datetime,
            TIMESTAMPDIFF(SECOND, NOW(), o.max_waiting_datetime) AS seconds_remaining,
            o.id_car_class,
            o.id_order_location,
            o.from_lat,
            o.from_lng,
            o.\x60from\x60 AS start_address,
            o.countries_list_from,
            o.countries_list_to,
            o.region_from,
            o.region_to,
            o.city_from,
            o.city_to,
            " . $distanceSql . ",
            (SELECT GROUP_CONCAT(oci.id_order_comment SEPARATOR ',')
               FROM order_comment_items oci
              WHERE oci.id_order = o.id_order) AS order_comments,
            (SELECT GROUP_CONCAT(os.id_service SEPARATOR ',')
               FROM order_service os
              WHERE os.id_order = o.id_order) AS order_services,
            (SELECT COUNT(*)
               FROM order_driver od
              WHERE od.id_order = o.id_order
                AND od.id_user = " . $driverId . ") AS driver_already_assigned,
            (SELECT COUNT(*)
               FROM order_driver_attempt oda
              WHERE oda.id_order = o.id_order
                AND oda.id_user = " . $driverId . ") AS driver_attempts,
            (SELECT ods.cancel
               FROM order_driver_select ods
              WHERE ods.id_order = o.id_order
                AND ods.id_user = " . $driverId . "
              LIMIT 1) AS driver_offer_cancelled
        FROM \x60order\x60 o
        WHERE o.id_order = " . $orderId . "
        LIMIT 1";
    $orderResult = query($orderSql);
    if ($orderResult === false) json_exit('500', 'error', 'order query failed', null);
    $order = fetch_assoc($orderResult);
    if (empty($order['id_order'])) {
        explain_match_add_check($checks, 'order_exists', 'fail', 'ORDER_NOT_FOUND', 'Заказ не найден.');
        json_exit('200', 'success', null, array(
            'driver_id' => $driverId, 'order_id' => $orderId,
            'can_see_order' => false, 'decision' => 'not_visible', 'checks' => $checks
        ));
    }

    $driverRoleOk = (int)$driver['id_role'] === 2;
    $usedCarOk = !empty($driver['id_car']);
    $status = (int)$order['id_order_status'];
    $statusOk = $status === 1 ||
        ($status === 6 && isset($order['driver_offer_cancelled']) &&
            (string)$order['driver_offer_cancelled'] === '0');
    explain_match_add_check($checks, 'order_status', $statusOk ? 'pass' : 'fail',
        $statusOk ? null : 'ORDER_STATUS_NOT_ELIGIBLE',
        'id_order_status=' . $status . '; cancel для этого водителя=' .
        (isset($order['driver_offer_cancelled']) ? $order['driver_offer_cancelled'] : 'NULL') . '.');

    // selectProcessingOrder defaults to kind=1 when no explicit kind is supplied.
    $kindOk = (int)$order['kind'] === 1;
    explain_match_add_check($checks, 'order_kind', $kindOk ? 'pass' : 'fail',
        $kindOk ? null : 'ORDER_KIND_NOT_SELECTED',
        'kind=' . $order['kind'] . '; стандартный вызов подбора использует kind=1.');

    $deadlineOk = explain_match_deadline_satisfied($order['seconds_remaining']);
    explain_match_add_check($checks, 'waiting_deadline', $deadlineOk ? 'pass' : 'fail',
        $deadlineOk ? null : 'WAITING_DEADLINE_EXPIRED',
        'TIMESTAMPDIFF(SECOND, NOW(), max_waiting_datetime)=' .
        $order['seconds_remaining'] . '; время сравнивает MySQL.');

    $ownOrder = (int)$order['client'] === $driverId;
    explain_match_add_check($checks, 'not_own_order', $ownOrder ? 'fail' : 'pass',
        $ownOrder ? 'DRIVER_IS_ORDER_CLIENT' : null,
        $ownOrder ? 'Водитель является клиентом заказа.' : 'Водитель не является клиентом заказа.');

    $assigned = (int)$order['driver_already_assigned'] > 0;
    explain_match_add_check($checks, 'not_already_assigned', $assigned ? 'fail' : 'pass',
        $assigned ? 'DRIVER_ALREADY_ASSIGNED' : null,
        $assigned ? 'Водитель уже есть в order_driver.' : 'Назначения этому водителю нет.');

    $attemptLimit = null;
    if (isset(taxi::$data['site_constants']['driver_code_attempt_count_max']['value'])) {
        $attemptLimit = (int)taxi::$data['site_constants']['driver_code_attempt_count_max']['value'];
    }
    if ($attemptLimit !== null && $attemptLimit > 0) {
        $attempts = (int)$order['driver_attempts'];
        $attemptsOk = $attempts < $attemptLimit;
        explain_match_add_check($checks, 'driver_attempt_limit', $attemptsOk ? 'pass' : 'fail',
            $attemptsOk ? null : 'DRIVER_ATTEMPT_LIMIT_REACHED',
            'Попыток=' . $attempts . ', лимит=' . $attemptLimit . '.');
    } else {
        explain_match_add_check($checks, 'driver_attempt_limit', 'not_evaluated',
            'ATTEMPT_LIMIT_CONFIG_UNAVAILABLE',
            'Не удалось определить driver_code_attempt_count_max из конфигурации.');
    }

    $carClassOk = empty($order['id_car_class']) ||
        (!empty($driver['id_car_class']) && (string)$driver['id_car_class'] === (string)$order['id_car_class']);
    explain_match_add_check($checks, 'car_class', $carClassOk ? 'pass' : 'fail',
        $carClassOk ? null : 'CAR_CLASS_MISMATCH',
        'Класс автомобиля=' . (isset($driver['id_car_class']) ? $driver['id_car_class'] : 'NULL') .
        '; класс заказа=' . (isset($order['id_car_class']) ? $order['id_car_class'] : 'NULL') . '.');

    $driverLocations = explain_match_ids($driver['driver_location_classes']);
    $locationOk = in_array((int)$order['id_order_location'], $driverLocations, true);
    explain_match_add_check($checks, 'order_location_class', $locationOk ? 'pass' : 'fail',
        $locationOk ? null : 'ORDER_LOCATION_CLASS_NOT_ALLOWED',
        'Класс заказа=' . $order['id_order_location'] .
        '; классы водителя=' . implode(',', $driverLocations) . '.');

    $commentsOk = explain_match_requirements_satisfied(
        $driver['driver_comments'], $order['order_comments']);
    explain_match_add_check($checks, 'comments', $commentsOk ? 'pass' : 'fail',
        $commentsOk ? null : 'ORDER_COMMENT_REQUIREMENT_NOT_MET',
        $commentsOk
            ? 'Все комментарии/опции заказа присутствуют у водителя.'
            : 'Водителю не хватает как минимум одного комментария/опции, обязательного для заказа.');

    $servicesOk = explain_match_requirements_satisfied(
        $driver['driver_services'], $order['order_services']);
    explain_match_add_check($checks, 'services', $servicesOk ? 'pass' : 'fail',
        $servicesOk ? null : 'ORDER_SERVICE_REQUIREMENT_NOT_MET',
        $servicesOk
            ? 'Все услуги заказа присутствуют у водителя.'
            : 'Водителю не хватает как минимум одной услуги, обязательной для заказа.');

    $speed = 60;
    if (isset(taxi::$data['site_constants']['average_speed']['value']) &&
        is_numeric(taxi::$data['site_constants']['average_speed']['value']) &&
        (float)taxi::$data['site_constants']['average_speed']['value'] > 0) {
        $speed = (float)taxi::$data['site_constants']['average_speed']['value'];
    }
    if (!$hasDriverCoordinates) {
        // The production selector activates its distance branch only if both
        // driver coordinates are present.
        explain_match_add_check($checks, 'arrival_time', 'pass', null,
            'У водителя нет координат; production selector не включает фильтр расстояния.');
    } elseif (!is_numeric($order['backend_distance_m'])) {
        explain_match_add_check($checks, 'arrival_time', 'fail', 'DISTANCE_NOT_COMPUTABLE',
            'Координаты точки подачи отсутствуют или расстояние не вычисляется; SQL-фильтр production selector исключает такую строку.');
    } else {
        $distanceOk = explain_match_arrival_satisfied(
            $order['backend_distance_m'], $order['seconds_remaining'], $speed);
        $distanceDetails = 'Расстояние по формуле Haversine=' .
            round((float)$order['backend_distance_m']) . ' м; осталось секунд=' .
            $order['seconds_remaining'] . '; средняя скорость=' . $speed .
            ' км/ч; допустимое расстояние=' .
            round(max(0, (float)$order['seconds_remaining']) * $speed / 3.6) . ' м.';
        if ($distanceOk && function_exists('get_place') &&
            function_exists('get_distance') && function_exists('lat_lng_to_square') &&
            empty($order['start_address'])) {
            $placeCar = get_place($driver['lat'], $driver['lng']);
            $placeOrder = get_place($order['from_lat'], $order['from_lng']);
            if (!empty($placeCar) && !empty($placeOrder) &&
                isset($placeCar['id'], $placeOrder['id']) &&
                $placeCar['id'] == $placeOrder['id']) {
                $localDistance = get_distance(
                    $placeCar['id'],
                    lat_lng_to_square($driver['lat'], $driver['lng'], $placeCar),
                    lat_lng_to_square($order['from_lat'], $order['from_lng'], $placeOrder)
                );
                if (gettype($localDistance) === 'double' &&
                    $localDistance > ((float)$order['seconds_remaining'] * $speed / 3.6)) {
                    $distanceOk = false;
                    $distanceDetails .= ' Дополнительный get_distance() backend-фильтр также проверен и не пройден: ' .
                        round($localDistance) . ' м.';
                } elseif (gettype($localDistance) === 'double') {
                    $distanceDetails .= ' Дополнительный get_distance() backend-фильтр пройден: ' .
                        round($localDistance) . ' м.';
                }
            }
        }
        explain_match_add_check($checks, 'arrival_time', $distanceOk ? 'pass' : 'fail',
            $distanceOk ? null : 'ARRIVAL_TIME_EXCEEDED', $distanceDetails);
    }

    // The production selector also has a dynamic taxi-license / geographic
    // rule driven by car-class configuration and order_location metadata.
    // Do not claim a match if this separate rule cannot be reconstructed from
    // the template execution context.
    explain_match_add_check($checks, 'license_geography', 'not_evaluated',
        'LICENSE_RULES_NEED_PLATFORM_METADATA',
        'Лицензии и географические booking_location_classes не подтверждены: их конфигурация должна быть доступна в контексте шаблона.');

    $hasFail = false;
    $hasUnknown = false;
    foreach ($checks as $check) {
        if ($check['status'] === 'fail') $hasFail = true;
        if ($check['status'] === 'not_evaluated') $hasUnknown = true;
    }
    $canSee = $hasFail ? false : ($hasUnknown ? null : true);
    $decision = $hasFail ? 'not_visible' : ($hasUnknown ? 'unknown' : 'passes_checked_rules');
    json_exit('200', 'success', null, array(
        'driver_id' => $driverId,
        'order_id' => $orderId,
        'can_see_order' => $canSee,
        'decision' => $decision,
        'checks' => $checks
    ));
});
