<?php
/**
 * Behavioral tests for explain_match.php.
 * A small fake DB exercises the actual template result, not source-text patterns.
 */
if (!defined('UID')) define('UID', 'session_user_id');

class ExplainMatchTestExit extends Exception
{
    public $payload;
    public function __construct($payload)
    {
        $this->payload = $payload;
        parent::__construct('json_exit intercepted');
    }
}
class ExplainMatchTestResult
{
    public $row;
    public function __construct($row) { $this->row = $row; }
}
class taxi
{
    public static $data = array(
        'site_constants' => array(
            'driver_code_attempt_count_max' => array('value' => 3),
            'average_speed' => array('value' => 60)
        )
    );
}

$GLOBALS['explain_match_case'] = array();
$GLOBALS['explain_match_queries'] = array();

function query($sql)
{
    $GLOBALS['explain_match_queries'][] = $sql;
    $case = $GLOBALS['explain_match_case'];
    if (strpos($sql, 'FROM users u') !== false) {
        return new ExplainMatchTestResult($case['driver']);
    }
    $orderTable = 'FROM ' . chr(96) . 'order' . chr(96) . ' o';
    if (strpos($sql, $orderTable) !== false) {
        return new ExplainMatchTestResult($case['order']);
    }
    return false;
}
function fetch_assoc($result)
{
    return $result instanceof ExplainMatchTestResult ? $result->row : false;
}
function json_exit($code, $status, $message, $data)
{
    throw new ExplainMatchTestExit(array(
        'code' => $code, 'status' => $status, 'message' => $message, 'data' => $data
    ));
}

class ExplainMatchTemplateRunner
{
    public $id_role = 4;
    public function run()
    {
        include __DIR__ . '/../server/script_templates/explain_match.php';
    }
}

$tests = 0;
$failures = array();

function check_same($expected, $actual, $label)
{
    global $tests, $failures;
    $tests++;
    if ($expected !== $actual) {
        $failures[] = $label . ': expected ' . var_export($expected, true) .
            ', got ' . var_export($actual, true);
    }
}
function check_true($actual, $label)
{
    check_same(true, (bool)$actual, $label);
}
function run_explain_case($overrides)
{
    $driver = array(
        'id_user' => '20', 'id_role' => '2', 'lat' => null, 'lng' => null,
        'id_car' => '5', 'id_car_class' => '2',
        'driver_comments' => '1,2', 'driver_services' => '3,4',
        'driver_location_classes' => '1,2'
    );
    $order = array(
        'id_order' => '99', 'client' => '30', 'id_order_status' => '1', 'kind' => '1',
        'max_waiting_datetime' => '2026-10-16 15:00:00', 'seconds_remaining' => '120',
        'id_car_class' => '2', 'id_order_location' => '1',
        'from_lat' => null, 'from_lng' => null, 'start_address' => 'Pickup',
        'countries_list_from' => '', 'countries_list_to' => '',
        'region_from' => '', 'region_to' => '', 'city_from' => '', 'city_to' => '',
        'backend_distance_m' => null, 'order_comments' => '1,2', 'order_services' => '3,4',
        'driver_already_assigned' => '0', 'driver_attempts' => '0',
        'driver_offer_cancelled' => null
    );
    if (isset($overrides['driver'])) $driver = array_merge($driver, $overrides['driver']);
    if (isset($overrides['order'])) $order = array_merge($order, $overrides['order']);
    $GLOBALS['explain_match_case'] = array('driver' => $driver, 'order' => $order);
    $GLOBALS['explain_match_queries'] = array();
    $_SESSION = array(UID => 4);
    $_REQUEST = array('s_t_data' => json_encode(array('driver_id' => 20, 'order_id' => 99)));
    $runner = new ExplainMatchTemplateRunner();
    try {
        $runner->run();
    } catch (ExplainMatchTestExit $e) {
        return array('response' => $e->payload, 'queries' => $GLOBALS['explain_match_queries']);
    }
    return array('response' => null, 'queries' => $GLOBALS['explain_match_queries']);
}
function check_status($result, $name, $expected, $label)
{
    $checks = isset($result['response']['data']['checks']) ? $result['response']['data']['checks'] : array();
    foreach ($checks as $check) {
        if ($check['name'] === $name) {
            check_same($expected, $check['status'], $label);
            return;
        }
    }
    check_same('check-found', 'missing', $label . ' (check not returned)');
}

// The template itself must return a diagnostic response and perform SELECTs only.
$baseline = run_explain_case(array());
check_same('200', $baseline['response']['code'], 'baseline returns success envelope');
check_same(null, $baseline['response']['data']['can_see_order'], 'unevaluated license rule prevents a false positive');
check_status($baseline, 'comments', 'pass', 'all required comments pass');
check_status($baseline, 'services', 'pass', 'all required services pass');
check_true(count($baseline['queries']) === 2, 'exactly two read queries are issued');
foreach ($baseline['queries'] as $sql) {
    check_true(!preg_match('/\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE)\b/i', $sql), 'template queries do not mutate data');
}

$missingComment = run_explain_case(array(
    'driver' => array('driver_comments' => ''),
    'order' => array('order_comments' => '1')
));
check_status($missingComment, 'comments', 'fail', 'empty driver comments reject a required order comment');
check_same(false, $missingComment['response']['data']['can_see_order'], 'missing comment makes order not visible');

$partialComments = run_explain_case(array(
    'driver' => array('driver_comments' => '1'),
    'order' => array('order_comments' => '1,2')
));
check_status($partialComments, 'comments', 'fail', 'partial comment overlap rejects');

$missingService = run_explain_case(array(
    'driver' => array('driver_services' => ''),
    'order' => array('order_services' => '3')
));
check_status($missingService, 'services', 'fail', 'empty driver services reject required order service');

$partialServices = run_explain_case(array(
    'driver' => array('driver_services' => '3'),
    'order' => array('order_services' => '3,4')
));
check_status($partialServices, 'services', 'fail', 'partial service overlap rejects');

$noOrderRequirements = run_explain_case(array(
    'driver' => array('driver_comments' => '', 'driver_services' => ''),
    'order' => array('order_comments' => '', 'order_services' => '')
));
check_status($noOrderRequirements, 'comments', 'pass', 'empty order comments are unrestricted');
check_status($noOrderRequirements, 'services', 'pass', 'empty order services are unrestricted');

$expired = run_explain_case(array('order' => array('seconds_remaining' => '0')));
check_status($expired, 'waiting_deadline', 'fail', 'MySQL deadline at NOW is rejected');
check_same(false, $expired['response']['data']['can_see_order'], 'expired deadline makes order not visible');

$future = run_explain_case(array('order' => array('seconds_remaining' => '1')));
check_status($future, 'waiting_deadline', 'pass', 'positive MySQL seconds remaining passes');

$distancePass = run_explain_case(array(
    'driver' => array('lat' => '0', 'lng' => '0'),
    'order' => array('from_lat' => '0', 'from_lng' => '1', 'backend_distance_m' => '1000',
        'seconds_remaining' => '60', 'start_address' => 'Pickup')
));
check_status($distancePass, 'arrival_time', 'pass', 'distance within average-speed threshold passes');

$distanceFail = run_explain_case(array(
    'driver' => array('lat' => '0', 'lng' => '0'),
    'order' => array('from_lat' => '0', 'from_lng' => '1', 'backend_distance_m' => '1001',
        'seconds_remaining' => '60', 'start_address' => 'Pickup')
));
check_status($distanceFail, 'arrival_time', 'fail', 'distance over average-speed threshold fails');

$missingCoordinates = run_explain_case(array(
    'driver' => array('lat' => '0', 'lng' => '0'),
    'order' => array('from_lat' => null, 'from_lng' => null, 'backend_distance_m' => null)
));
check_status($missingCoordinates, 'arrival_time', 'fail', 'missing pickup coordinates fail when driver distance filter is active');

$wrongKind = run_explain_case(array('order' => array('kind' => '2')));
check_status($wrongKind, 'order_kind', 'fail', 'non-default kind is rejected by default selector');

$alreadyAssigned = run_explain_case(array('order' => array('driver_already_assigned' => '1')));
check_status($alreadyAssigned, 'not_already_assigned', 'fail', 'existing assignment rejects');

if (count($failures)) {
    foreach ($failures as $failure) fwrite(STDERR, "FAIL: " . $failure . PHP_EOL);
    fwrite(STDERR, count($failures) . " of " . $tests . " behavioral checks failed." . PHP_EOL);
    exit(1);
}
echo "PASS: " . $tests . " template behavioral checks." . PHP_EOL;
