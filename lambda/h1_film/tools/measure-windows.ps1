param(
    [Parameter(Mandatory)][int]$RunnerId,
    [int]$EngineId,
    [int]$EncoderId,
    [int]$ValidatorId,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$StopFile
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class H1ProcessMetrics {
    [StructLayout(LayoutKind.Sequential)]
    public struct Memory {
        public uint cb, faults;
        public UIntPtr peakWorkingSet, workingSet, peakPaged, paged, peakNonpaged, nonpaged;
        public UIntPtr pagefile, peakPagefile, privateBytes;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
    [DllImport("psapi.dll", SetLastError=true)]
    public static extern bool GetProcessMemoryInfo(IntPtr handle, ref Memory memory, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll")]
    public static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
}
'@
$handles = @{}
$peaks = @{}
$timer = [Diagnostics.Stopwatch]::StartNew()
$samples = 0
$combinedRss = 0L
$combinedCommit = 0L
try {
    foreach ($entry in @{runner=$RunnerId; engine=$EngineId; encoder=$EncoderId; validator=$ValidatorId}.GetEnumerator()) {
        if ($entry.Value -le 0) { continue }
        $handle = [H1ProcessMetrics]::OpenProcess(0x410, $false, $entry.Value)
        if ($handle -eq [IntPtr]::Zero) { throw "Cannot open $($entry.Key) process $($entry.Value)" }
        $handles[$entry.Key] = $handle
        $peaks[$entry.Key] = @{pid=$entry.Value; peak_working_set_bytes=0L; peak_commit_bytes=0L; cpu_seconds=0.0}
    }
    do {
        $rss = 0L
        $commit = 0L
        $active = 0
        foreach ($entry in $handles.GetEnumerator()) {
            $m = New-Object H1ProcessMetrics+Memory
            $m.cb = [Runtime.InteropServices.Marshal]::SizeOf($m)
            if ([H1ProcessMetrics]::GetProcessMemoryInfo($entry.Value, [ref]$m, $m.cb)) {
                $row = $peaks[$entry.Key]
                $row.peak_working_set_bytes = [Math]::Max($row.peak_working_set_bytes, [long]$m.peakWorkingSet.ToUInt64())
                $row.peak_commit_bytes = [Math]::Max($row.peak_commit_bytes, [long]$m.peakPagefile.ToUInt64())
                $rss += [long]$m.workingSet.ToUInt64()
                $commit += [long]$m.pagefile.ToUInt64()
            }
            $created = $exited = $kernel = $userTime = 0L
            if ([H1ProcessMetrics]::GetProcessTimes($entry.Value, [ref]$created, [ref]$exited, [ref]$kernel, [ref]$userTime)) {
                $peaks[$entry.Key].cpu_seconds = ($kernel + $userTime) / 10000000.0
                $peaks[$entry.Key].user_seconds = $userTime / 10000000.0
                $peaks[$entry.Key].kernel_seconds = $kernel / 10000000.0
            }
            $code = 0u
            if ([H1ProcessMetrics]::GetExitCodeProcess($entry.Value, [ref]$code)) {
                $peaks[$entry.Key].exit_code = $code
                if ($entry.Key -ne 'runner' -and $code -eq 259) { $active++ }
            }
        }
        $combinedRss = [Math]::Max($combinedRss, $rss)
        $combinedCommit = [Math]::Max($combinedCommit, $commit)
        $samples++
        if ($active -eq 0 -or (Test-Path -LiteralPath $StopFile)) { break }
        Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 3600)
    @{
        schema='halospawns.windowsPipelineMetrics.v1'; sample_interval_ms=100; samples=$samples
        monitor_seconds=$timer.Elapsed.TotalSeconds; processes=$peaks
        sampled_combined_working_set_bytes=$combinedRss; sampled_combined_commit_bytes=$combinedCommit
        notes=@('Process peaks are OS lifetime high-water marks; combined peaks are sampled sums.',
            'Sum of working sets can double-count shared pages; excludes this measurement helper.',
            'CPU times are cumulative OS process times; runner includes preflight/staging.')
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Output -Encoding utf8
} finally {
    foreach ($handle in $handles.Values) { [H1ProcessMetrics]::CloseHandle($handle) | Out-Null }
}
