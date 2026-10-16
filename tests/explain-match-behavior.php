<?php
/**
 * Behavioral tests for the pure matching predicates used by explain_match.php.
 * These execute the actual helper functions, not source-text assertions.
 */
define('EXPLAIN_MATCH_TEST_MODE', true);
require __DIR__ . '/../server/script_templates/explain_match.php';

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

check_same(true, explain_match_requirements_satisfied('', ''), 'empty requirements are unrestricted');
check_same(true, explain_match_requirements_satisfied('', array()), 'empty array requirements are unrestricted');
check_same(true, explain_match_requirements_satisfied('1,2', '1,2'), 'all required comments/services available');
check_same(true, explain_match_requirements_satisfied('1,2,3', '1,2'), 'extra driver options are allowed');
check_same(false, explain_match_requirements_satisfied('1', '1,2'), 'missing one required option rejects');
check_same(false, explain_match_requirements_satisfied('', '1'), 'empty driver list rejects required option');
check_same(false, explain_match_requirements_satisfied('1,3', '1,2'), 'different option does not count as a match');
check_same(true, explain_match_deadline_satisfied(1), 'positive MySQL seconds remaining passes');
check_same(false, explain_match_deadline_satisfied(0), 'deadline at NOW fails');
check_same(false, explain_match_deadline_satisfied(-1), 'expired deadline fails');
check_same(false, explain_match_deadline_satisfied(null), 'unknown deadline does not pass');
check_same(true, explain_match_arrival_satisfied(1000, 60, 60), 'distance exactly at speed threshold passes');
check_same(false, explain_match_arrival_satisfied(1001, 60, 60), 'distance over speed threshold fails');
check_same(false, explain_match_arrival_satisfied(1000, 0, 60), 'no remaining time fails');
check_same(false, explain_match_arrival_satisfied(null, 60, 60), 'unknown distance fails when distance filter is active');
check_same(0.0, round(explain_match_haversine_m(0, 0, 0, 0), 1), 'same coordinates have zero distance');
check_same(true, explain_match_haversine_m(0, 0, 0, 1) > 111000, 'one longitude degree is about 111 km at the equator');
check_same(true, explain_match_haversine_m(0, 0, 0, 1) < 112000, 'Haversine uses Earth radius in metres');

if (count($failures)) {
    foreach ($failures as $failure) fwrite(STDERR, "FAIL: " . $failure . PHP_EOL);
    fwrite(STDERR, count($failures) . " of " . $tests . " behavioral checks failed." . PHP_EOL);
    exit(1);
}
echo "PASS: " . $tests . " behavioral checks." . PHP_EOL;
