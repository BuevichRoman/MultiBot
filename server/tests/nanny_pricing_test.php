<?php
/**
 * Проверка nanny_pricing.php без платформы: taxi, база и createOrder подставные.
 * Запуск: docker run --rm -v "$PWD/server":/s -w /s php:5.6-cli php tests/nanny_pricing_test.php
 */
error_reporting(E_ALL);
define('UID', 'uid');

class taxi { static $data = array(); static $data_sc = array(); static $data_private = array(); }
class JsonExit extends Exception { public $out; function __construct($o) { $this->out = $o; parent::__construct('json_exit'); } }
function json_exit($code, $status, $msg = null, $data = null) { throw new JsonExit(array('code' => $code, 'status' => $status, 'message' => $msg, 'data' => $data)); }

$ORDERS = array();     // id => row
$LOCKS = 0;
function real_escape_string($s) { return addslashes($s); }
function fetch_assoc($q) { return is_array($q) ? array_shift($q) : null; }
function query($s) {
    global $ORDERS, $LOCKS;
    if (preg_match("/GET_LOCK/", $s)) { $LOCKS++; return array(array('l' => 1)); }
    if (preg_match("/RELEASE_LOCK/", $s)) { $LOCKS--; return array(array('r' => 1)); }
    if (preg_match('/requestKey":"([^"]+)"/', $s, $m) && preg_match("/`client` = '(\d+)'/", $s, $c)) {
        foreach (array_reverse($ORDERS, true) as $id => $o)
            if ($o['client'] == $c[1] && strpos($o['options'], '"requestKey":"' . $m[1] . '"') !== false) return array(array('id_order' => $id));
        return array();
    }
    if (preg_match("/FROM `order_driver` WHERE `id_order` = '(\d+)' AND `id_user` = '(\d+)'/", $s, $m)) {
        return (isset($ORDERS[$m[1]]['driver']) && $ORDERS[$m[1]]['driver'] == $m[2]) ? array(array(1 => 1)) : array();
    }
    if (preg_match("/FROM `order` WHERE `id_order` = '(\d+)'/", $s, $m)) {
        return isset($ORDERS[$m[1]]) ? array($ORDERS[$m[1]]) : array();
    }
    throw new Exception('unexpected SQL: ' . $s);
}

class FakeApi {
    public $id_role = 1;
    public $created = 0;
    function createOrder($json) {
        global $ORDERS;
        $d = json_decode($json, true);
        $id = 4300 + count($ORDERS);
        $ORDERS[$id] = array('client' => $_SESSION[UID], 'options' => json_encode($d['b_options']),
            'datetime_start_plan' => '2026-07-01 23:00:00', 'complete_datetime' => null);
        $this->created++;
        return array('code' => '200', 'status' => 'success', 'data' => array('b_id' => $id));
    }
    function run($in) {
        $_REQUEST['s_t_data'] = json_encode($in);
        try { include __DIR__ . '/../script_templates/nanny_pricing.php'; } catch (JsonExit $e) { return $e->out; }
        throw new Exception('template ended without json_exit');
    }
}

$model = array('version' => '1.0', 'pricing_models' => array('basic' => array(
    'constants' => array('base_price' => 200, 'price_per_km' => 10, 'price_per_minute' => 5, 'time_ratio' => array('night' => 0.5, 'day' => 1)),
    'model' => array('expression' => '(base_price+distance*price_per_km+duration*price_per_minute)*time_ratio*car_class_ratio+options_sum+submit_price'))));
taxi::$data['site_constants']['pricingModels']['value'] = json_encode($model);
taxi::$data['booking_comments'] = array('1' => array('options' => array('price' => 80)), '4' => array('options' => '{"price":110}'));
$_SESSION[UID] = 888;

$fails = 0;
function check($name, $cond) { global $fails; echo ($cond ? 'ok   ' : 'FAIL ') . $name . "\n"; if (!$cond) $fails++; }
$api = new FakeApi();

// quote: день/ночь по часу начала в поясе заказа
$r = $api->run(array('action' => 'quote', 'when' => '2026-07-01 19:30:00+00:00', 'time_zone' => 'Europe/Madrid', 'options' => array()));
check('21:30 Мадрид — день, 200', $r['status'] === 'success' && $r['data']['price'] === '200');
$r = $api->run(array('action' => 'quote', 'when' => '2026-07-01 20:30:00+00:00', 'time_zone' => 'Europe/Madrid', 'options' => array()));
check('22:30 Мадрид — ночь, 100', $r['data']['price'] === '100' && $r['data']['options']['time_ratio'] == 0.5);
$r = $api->run(array('action' => 'quote', 'when' => '2026-12-01 05:30:00+00:00', 'time_zone' => 'Europe/Madrid', 'options' => array(1, 4)));
check('зима 06:30 CET — день, опции 80+110 → 390', $r['data']['price'] === '390');
$r = $api->run(array('action' => 'quote', 'when' => '2026-07-01 04:30:00+00:00', 'time_zone' => 'Bad/Zone', 'options' => array()));
check('неизвестный пояс → Europe/Madrid (06:30 — день)', $r['data']['price'] === '200');
check('ответ в форме pricingModel', $r['data']['calculationType'] === 'incomplete' && isset($r['data']['formula'], $r['data']['options']['base_price']));

// create: цена сервера в заказе, повтор не создаёт второй
$order = array('b_start_datetime' => '2026-07-01 20:30:00+00:00', 'b_comments' => array(1),
    'b_options' => array('pricingModel' => array('price' => '1'), 'createdBy' => 'whatsapp'));
$r1 = $api->run(array('action' => 'create', 'request_key' => 'req-abc-123', 'time_zone' => 'Europe/Madrid', 'order' => $order));
$o = json_decode($ORDERS[$r1['data']['b_id']]['options'], true);
check('create: заказ создан', $r1['status'] === 'success' && $r1['data']['duplicate'] === false);
check('create: цена клиента заменена серверной (ночь 100 + 80)', $o['pricingModel']['price'] === '180' && $o['requestKey'] === 'req-abc-123');
check('create: прочие b_options сохранены', $o['createdBy'] === 'whatsapp');
$r2 = $api->run(array('action' => 'create', 'request_key' => 'req-abc-123', 'time_zone' => 'Europe/Madrid', 'order' => $order));
check('повтор с тем же ключом → тот же b_id, duplicate', $r2['data']['b_id'] === $r1['data']['b_id'] && $r2['data']['duplicate'] === true && $api->created === 1);
$_SESSION[UID] = 999;
$r3 = $api->run(array('action' => 'create', 'request_key' => 'req-abc-123', 'time_zone' => 'Europe/Madrid', 'order' => $order));
check('тот же ключ у другого клиента — новый заказ', $r3['data']['duplicate'] === false && $api->created === 2);
$_SESSION[UID] = 888;
check('блокировки отпущены', $LOCKS === 0);
$r = $api->run(array('action' => 'create', 'request_key' => "x' OR 1=1 --", 'order' => $order));
check('кривой request_key отклонён', $r['status'] === 'error' && $r['message'] === 'wrong request_key');

// final: длительность от начала до завершения, права
$id = $r1['data']['b_id'];
$ORDERS[$id]['complete_datetime'] = '2026-07-02 01:00:00';   // 120 мин от 23:00
$r = $api->run(array('action' => 'final', 'b_id' => $id));
check('final: (200+120*5)*0.5+80 = 480', $r['status'] === 'success' && $r['data']['price'] === '480' && $r['data']['options']['duration'] === 120);
$_SESSION[UID] = 887;
$r = $api->run(array('action' => 'final', 'b_id' => $id));
check('final: чужому — отказ', $r['status'] === 'error' && $r['message'] === 'not enough rights');
$ORDERS[$id]['driver'] = 887;
$r = $api->run(array('action' => 'final', 'b_id' => $id));
check('final: няне заказа — можно', $r['status'] === 'success');
$_SESSION[UID] = 888;
$ORDERS[$id]['complete_datetime'] = null;
$r = $api->run(array('action' => 'final', 'b_id' => $id));
check('final: не завершён — цена из заказа', $r['data']['price'] === '180');
$r = $api->run(array('action' => 'final', 'b_id' => $id, 'duration_min' => 95));
check('final: за 95 минут — (200+95*5)*0.5+80 = 417', $r['data']['price'] === '417' && $r['data']['options']['duration'] === 95);
$r = $api->run(array('action' => 'final', 'b_id' => $id, 'duration_min' => -1));
check('final: отрицательная длительность — ошибка', $r['message'] === 'wrong duration_min');

// формула: без eval
taxi::$data['site_constants']['pricingModels']['value'] = json_encode(array('pricing_models' => array('basic' => array('constants' => array(), 'model' => array('expression' => 'system("id")')))));
$r = $api->run(array('action' => 'quote', 'options' => array()));
check('не арифметика — ошибка, не исполнение', $r['status'] === 'error' && strpos($r['message'], 'price calculation failed') === 0);
taxi::$data['site_constants']['pricingModels']['value'] = json_encode(array('pricing_models' => array('basic' => array('constants' => array('base_price' => 200), 'model' => array('expression' => '-(base_price-50)/2+1.5e1*2')))));
$r = $api->run(array('action' => 'quote', 'options' => array()));
check('унарный минус, скобки, 1.5e1 → -45', $r['data']['price'] === '-45');
$r = $api->run(array('action' => 'nope'));
check('неизвестное действие', $r['message'] === 'unknown action');

echo $fails ? "\nFAILED: $fails\n" : "\nВсе проверки пройдены\n";
exit($fails ? 1 : 0);
