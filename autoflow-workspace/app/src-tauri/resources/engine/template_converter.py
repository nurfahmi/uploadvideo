#!/usr/bin/env python3
"""Convert a recorded template JSON → runnable flow.json.

Usage:
    python template_converter.py <template_json_path> <flow_dir>

Produces `<flow_dir>/flow.json` that the engine can execute.
"""
import json
import os
import re
import sys


def short_activity(act):
    if not act:
        return None
    return act.split('/')[-1].split('.')[-1].rstrip('_')


def is_generic_selector(element, screen_size):
    """Bounds covering > 15% of screen, or container-suffix resource-id, or
    layout className without text — treat as non-specific; coord safer."""
    bounds = element.get('bounds')
    if bounds and len(bounds) == 4:
        w = screen_size.get('width', 720)
        h = screen_size.get('height', 1612)
        area_ratio = ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / float(w * h)
        if area_ratio > 0.15:
            return True
    rid = (element.get('resourceId') or '').lower()
    for suf in ('_root', '_container', '_panel', '_layout', 'main_view', 'content'):
        if rid.endswith(suf):
            return True
    cls = element.get('className') or ''
    if cls in ('android.view.ViewGroup', 'android.widget.RelativeLayout',
               'android.widget.LinearLayout', 'android.widget.FrameLayout'):
        if not element.get('text') and not element.get('contentDescription'):
            return True
    return False


def build_selector(element, exclude_keys=()):
    sel = {}
    if 'resourceId' not in exclude_keys and element.get('resourceId'):
        sel['resourceId'] = element['resourceId']
    if 'contentDescription' not in exclude_keys and element.get('contentDescription'):
        sel['contentDescription'] = element['contentDescription']
    if 'text' not in exclude_keys and element.get('text') \
            and element.get('text') != element.get('contentDescription'):
        sel['text'] = element['text']
    if not sel and 'className' not in exclude_keys and element.get('className'):
        sel['className'] = element['className']
    return sel


def smart_scale_coord(pct_x, pct_y, recorded_size, target_size):
    """Compute target (x, y) from recorded pct. Uses edge-anchor for regions
    near screen edges (preserve absolute px offset, robust against status bar
    height drift between devices), pct scaling for center regions."""
    rw = recorded_size.get('width', 720)
    rh = recorded_size.get('height', 1612)
    tw = target_size.get('width', rw)
    th = target_size.get('height', rh)

    # Recorded absolute px
    rx = pct_x * rw
    ry = pct_y * rh

    # X axis
    if pct_x > 0.8:  # right-edge region → anchor from right
        offset_from_right = rw - rx
        x = tw - offset_from_right
    elif pct_x < 0.2:  # left-edge region → anchor from left (preserve abs)
        x = rx
    else:
        x = tw * pct_x

    # Y axis
    if pct_y < 0.2:  # top region (status bar + header) → anchor from top
        y = ry
    elif pct_y > 0.8:  # bottom (nav bar) → anchor from bottom
        offset_from_bottom = rh - ry
        y = th - offset_from_bottom
    else:
        y = th * pct_y

    return int(round(x)), int(round(y))


def convert_step(s, i, delay_after, screen_size, target_size=None):
    action = s['action']
    el = s.get('element', {})
    base = {'description': f"Step {i}: {action}"}

    if action == 'screenshot':
        return {
            'action': 'screenshot',
            'output': s.get('output', f'_shot_{i}.png'),
            'description': f"Step {i}: screenshot",
            'optional': True,
            'delay_after': delay_after,
        }

    if action == 'tap':
        pct = s.get('coord_pct', {})
        generic = is_generic_selector(el, screen_size)
        sel = build_selector(el) if not generic else {}

        def coord_fallback(step):
            """Add smart-scaled coord fallback if target known, else pct."""
            if not pct:
                return
            if target_size:
                tx, ty = smart_scale_coord(pct['x_pct'], pct['y_pct'], screen_size, target_size)
                step['fallback_tap_pct'] = {
                    'x_pct': tx / target_size['width'],
                    'y_pct': ty / target_size['height'],
                    'x_abs': tx,
                    'y_abs': ty,
                    'source': 'smart_scale',
                }
            else:
                step['fallback_tap_pct'] = {'x_pct': pct['x_pct'], 'y_pct': pct['y_pct']}

        if sel:
            step = {'action': 'u2_click', **sel, **base}
            coord_fallback(step)
        elif pct:
            if target_size:
                tx, ty = smart_scale_coord(pct['x_pct'], pct['y_pct'], screen_size, target_size)
                step = {
                    'action': 'tap_pct',
                    'x_pct': tx / target_size['width'],
                    'y_pct': ty / target_size['height'],
                    'x_abs': tx,
                    'y_abs': ty,
                    **base,
                }
                if generic:
                    step['description'] += f' (smart-scaled to {tx},{ty})'
            else:
                step = {'action': 'tap_pct', 'x_pct': pct['x_pct'], 'y_pct': pct['y_pct'], **base}
                if generic:
                    step['description'] += ' (coord)'
        else:
            return None
        if s.get('activity_changed'):
            wait = short_activity(s.get('activity_after'))
            if wait:
                step['wait_for'] = wait
                step['wait_timeout'] = 20
                step['retry'] = 2
        # Preserve expected_activity for Sprint 4c interruption detection
        if s.get('activity_before'):
            step['expected_activity'] = short_activity(s.get('activity_before'))
        step['delay_after'] = delay_after
        return step

    if action == 'type':
        sel = build_selector(el, exclude_keys=('text',))
        if not sel and el.get('className'):
            sel = {'className': el['className']}
        step = {
            'action': 'u2_type',
            **sel,
            'text': s.get('text', ''),
            'clear': not s.get('append', False),
            **base,
        }
        if s.get('activity_before'):
            step['expected_activity'] = short_activity(s.get('activity_before'))
        step['delay_after'] = delay_after
        return step

    return None


def normalize_launcher_first(orig):
    """If first step is tap launcher icon with activity change to target app,
    convert to launch_intent — more reliable than depending on launcher state."""
    if orig.get('action') != 'tap':
        return None
    rid = (orig.get('element', {}).get('resourceId') or '').lower()
    if 'launcher' not in rid:
        return None
    after = orig.get('activity_after', '')
    if not after or '/' not in after:
        return None
    pkg, act = after.split('/', 1)
    return {
        'action': 'launch_intent',
        'intent': f'-n {pkg}/{act}',
        'description': 'Launch target app (auto)',
        'wait_for': short_activity(after),
        'wait_timeout': 20,
        'retry': 2,
        'delay_after': 3,
    }


def build_launch_intent_step(raw_steps, target_pkg):
    """Build a launch_intent step that opens the target app to wherever the
    recording started. Used when the user began recording with the app already
    open (so no launcher-tap step exists) — engine needs to re-open the app
    after the prep phase kills it.

    Scans raw steps for the first activity that belongs to the target package.
    Falls back to package's HomeActivity if no in-app activity found.
    """
    if not target_pkg:
        return None
    # Find first activity within target package
    first_act = None
    for s in raw_steps:
        for key in ('activity_before', 'activity_after'):
            act = s.get(key) or ''
            if act.startswith(target_pkg + '/'):
                first_act = act
                break
        if first_act:
            break
    if not first_act:
        # Fallback: package only — system picks default launcher activity
        return {
            'action': 'launch_intent',
            'intent': f'-a android.intent.action.MAIN -p {target_pkg}',
            'description': f'Launch {target_pkg} (auto, no activity captured)',
            'wait_timeout': 20,
            'retry': 2,
            'delay_after': 3,
        }
    pkg, act = first_act.split('/', 1)
    return {
        'action': 'launch_intent',
        'intent': f'-n {pkg}/{act}',
        'description': 'Launch target app (auto, recording started mid-app)',
        'wait_for': short_activity(first_act),
        'wait_timeout': 20,
        'retry': 2,
        'delay_after': 3,
    }


def detect_target_package(steps):
    """Find the target app package from first step's activity_after or launch_intent."""
    for s in steps[:3]:
        after = s.get('activity_after') or ''
        if '/' in after and not after.startswith('com.android') and not after.startswith('com.transsion'):
            return after.split('/', 1)[0]
    return None


def build_prep_phase(package):
    """Prep steps to push video + media-scan BEFORE launching the app.
    Ensures {{video_path}} is present on device so gallery-pick steps find it."""
    return [
        {'action': 'kill_app', 'package': package,
         'description': 'Prep 1: force-stop target app'},
        {'action': 'shell_cmd', 'command': 'mkdir -p /sdcard/DCIM/AutoFlow',
         'description': 'Prep 2: ensure AutoFlow dir exists'},
        {'action': 'shell_cmd', 'command': 'rm -f /sdcard/DCIM/AutoFlow/*',
         'description': 'Prep 3: clear old pushed media'},
        {'action': 'push_file', 'local_path': '{{video_path}}',
         'remote_path': '/sdcard/DCIM/AutoFlow/',
         'description': 'Prep 4: push video to device',
         'stop_on_fail': True},
        {'action': 'media_scan', 'path': '/sdcard/DCIM/AutoFlow/',
         'description': 'Prep 5: refresh media store'},
        {'action': 'wait', 'duration': 2,
         'description': 'Prep 6: settle media scan'},
    ]


def build_cleanup_phase(package):
    """Cleanup: force-stop the target app deterministically. Replaces
    OEM-specific 'tap recents → tap clear-all' sequences which break
    cross-device (itel trash icon vs Samsung 'Tutup semua' button)."""
    return [
        {'action': 'kill_app', 'package': package,
         'description': 'Cleanup: force-stop target app (cross-device)'},
    ]


def strip_trailing_launcher_steps(steps):
    """Strip recorded steps at the tail that end on the launcher/home screen.

    These are the user's own 'return to home + close recents' habit from
    recording. They're OEM-specific (launcher resourceIds differ per phone)
    and unreliable to replay cross-device. We replace them with a clean
    kill_app step in build_cleanup_phase().
    """
    def _is_launcher(activity):
        return bool(activity) and 'launcher' in activity.lower()

    keep_end = len(steps)
    for i in range(len(steps) - 1, -1, -1):
        s = steps[i]
        act_after = s.get('activity_after') or ''
        rid = (s.get('element', {}) or {}).get('resourceId', '') or ''
        is_cleanup = (
            _is_launcher(act_after)
            or 'recent_apps' in rid
            or 'recents_memory' in rid
            or 'clear_all' in rid.lower()
        )
        if is_cleanup:
            keep_end = i
        else:
            break
    return steps[:keep_end]


def _normalize_screen_size(s):
    """Accept both {width,height} and {w,h} key conventions."""
    if not s: return {'width': 720, 'height': 1612}
    return {
        'width': s.get('width') or s.get('w') or 720,
        'height': s.get('height') or s.get('h') or 1612,
    }


def convert_template(template_path, flow_dir, target_size=None):
    with open(template_path) as f:
        t = json.load(f)
    raw_steps = t['steps']
    # Strip OEM-specific closing steps (tap recents + clear-all). They record
    # on the source phone's launcher and won't match another OEM's launcher.
    # We replace them at the end with a deterministic kill_app instead.
    steps = strip_trailing_launcher_steps(raw_steps)
    screen_size = _normalize_screen_size(t.get('screen_size'))
    # Fallback: derive from first step's recorded screen_size if template-level missing
    if screen_size == {'width': 720, 'height': 1612} and steps:
        step_ss = steps[0].get('screen_size')
        if step_ss:
            screen_size = _normalize_screen_size(step_ss)
    converted = []
    for i, s in enumerate(steps):
        if s.get('custom_delay_seconds') is not None:
            delay_sec = max(0, min(120, float(s['custom_delay_seconds'])))
            if delay_sec == int(delay_sec):
                delay_sec = int(delay_sec)
        elif i + 1 < len(steps) and steps[i + 1].get('ts') and s.get('ts'):
            delay_sec = max(1, min(20, round((steps[i + 1]['ts'] - s['ts']) / 1000)))
        else:
            delay_sec = 2
        if i == 0:
            intent = normalize_launcher_first(s)
            if intent:
                converted.append(intent)
                continue
        st = convert_step(s, i + 1, delay_sec, screen_size, target_size)
        if st:
            converted.append(st)

    vars_list = sorted({
        m.group(1)
        for s in steps
        for m in re.finditer(r'\{\{(\w+)\}\}', s.get('text', ''))
    })
    # video_path is always declared (used by prep phase even if not in any type step)
    if 'video_path' not in vars_list:
        vars_list.append('video_path')
        vars_list.sort()
    batch_fields = [
        {'key': v, 'label': v, 'required': v in ('caption', 'video_path')}
        for v in vars_list
    ]

    # Auto-prepend prep phase to ensure {{video_path}} is on device before the
    # recorded flow runs (user didn't capture this during recording since it's
    # a laptop-side operation).
    # Detect against raw steps so we still find the target package even after
    # trailing launcher steps have been stripped above.
    target_pkg = detect_target_package(raw_steps)
    if target_pkg and 'video_path' in vars_list:
        prep = build_prep_phase(target_pkg)
        # If the first recorded step isn't already a launch_intent (e.g. user
        # started recording with the app already open), prepend one so the
        # engine re-opens the app after kill_app in the prep phase.
        needs_launch = not converted or converted[0].get('action') != 'launch_intent'
        if needs_launch:
            launch_step = build_launch_intent_step(raw_steps, target_pkg)
            if launch_step:
                converted = [launch_step] + converted
        converted = prep + converted
    # Append cleanup phase: kill_app for deterministic cross-device cleanup.
    if target_pkg:
        converted = converted + build_cleanup_phase(target_pkg)
    flow = {
        'name': f"{t['name']} (template)",
        'platform': t.get('platform', 'other'),
        'batch': True,
        'notes': f"Auto-generated from template {t['name']}",
        'batch_fields': batch_fields,
        'steps': converted,
    }

    os.makedirs(flow_dir, exist_ok=True)
    out_path = os.path.join(flow_dir, 'flow.json')
    with open(out_path, 'w') as f:
        json.dump(flow, f, indent=2)
    return {
        'flow_path': out_path,
        'step_count': len(converted),
        'batch_fields': [b['key'] for b in batch_fields],
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({'error': 'usage: template_converter.py <template.json> <flow_dir> [target_w] [target_h]'}))
        sys.exit(1)
    target = None
    if len(sys.argv) >= 5:
        try:
            target = {'width': int(sys.argv[3]), 'height': int(sys.argv[4])}
        except ValueError:
            pass
    try:
        result = convert_template(sys.argv[1], sys.argv[2], target_size=target)
        result['target_size'] = target
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
