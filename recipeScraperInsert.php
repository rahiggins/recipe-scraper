<!-- 

-->
 
<?php

function esc($mk) {
    $p = explode( "'", $mk);
    $mk1 = $p[0];
    for ($i = 1; $i < count($p); $i++) {
        $mk1 = $mk1."\'".$p[$i];
    }
    return $mk1;
}

$Months = [
	"01" =>"Jan",                     
	"02" =>"Feb",
	"03" =>"Mar",
	"04" =>"Apr",
	"05" =>"May", 
	"06" =>"Jun",
	"07" =>"Jul",
	"08" =>"Aug",
	"09" =>"Sep",
	"10" =>"Oct",
	"11" =>"Nov",
	"12" =>"Dec"
];

// Move along.  Nothing to see here.
$file = fopen("./NYTFND/license.txt", "r");        
eval(fgets($file));
eval(fgets($file));       
eval(fgets($file));
fclose($file);
unset($file);


ob_start();
?>

<html>
<head>
    <meta charset="UTF-8">
    <title>NYT Recipes: Update local database</title>
    <link rel="stylesheet" href="./spectre.min.css">
  </head>
<body>
<div class="pt-2 pl-2">
<div class="pt-2 pl-2">

<?php
// Connect to Mysql database.
try {
    $conn = new PDO($dsn, $user, $passwd);
	$conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
}
catch(PDOException $e) {
    echo "Connection failed: " . $e->getMessage();
    exit();
}
unset($dsn, $user, $passwd);

date_default_timezone_set("America/Chicago");
$export_name = date("Y-m-d");
$seq_name = "";
$seq = 0;
while (file_exists("/Applications/MAMP/htdocs/exports/".$export_name.$seq_name.".txt")) {
    $seq++;
    $seq_name = "-".str_pad(strval($seq), 2, "0", STR_PAD_LEFT);
}

$export_name = $export_name.$seq_name.".txt";    
$export = fopen("/Applications/MAMP/htdocs/exports/".$export_name, "a");
fwrite($export, 'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";'.PHP_EOL);
fwrite($export, 'SET time_zone = "+00:00";'.PHP_EOL);

$successfulInserts = 0;
$insertFiles = glob("./inserts/*.txt");
$insertsCount = count($insertFiles);
$lastInsertFilesIndex = $insertsCount - 1;
$write_insert = true;
for ($i = 0; $i < $insertsCount; $i++ ) {

    $filenm = $insertFiles[$i];
    $insert = "INSERT INTO days (year, month_num, month, day, markup) VALUES (:year, :month_num, :month, :day, :markup)";
    $stmt = $conn->prepare($insert);
    $stmt->bindParam(":year", $year);
    $stmt->bindParam(":month_num", $month_num);
    $stmt->bindParam(":month", $month);
    $stmt->bindParam(":day", $day);
    $stmt->bindParam(":markup", $markup);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_WARNING);

    $file = fopen($filenm, "r");
    $markup = fread($file, filesize($filenm));
    $pm = preg_match('/\d{2}\/\d{2}\/\d{4}/', $markup, $res);
    $keys = explode("/", $res[0]);
    $year = $keys[2];
    $day = $keys[1];
    $month_num = $keys[0];
    $month =  $Months[$month_num];
    $markup_esc = esc($markup);
    if ($stmt->execute()) {
        $successfulInserts++;
        if ($write_insert) {
            fwrite($export, "INSERT INTO `days` (`year`, `month_num`, `month`, `day`, `markup`) VALUES\n");
            $write_insert = false;
        }
        if ($i == $lastInsertFilesIndex) {
            $last_char = ";";
        } else {
            $last_char = ",";
        }
        $insert = "('".$year."', '".$month_num."', '".$month."', '".$day."', '".$markup_esc."')".$last_char."\n";
        fwrite($export, $insert);
        fclose($file);
        unlink($filenm);
    } else { 
        echo "Insert failed for ".$res[0].". See php.error.log<br>";
        fclose($file);
    }

}
if ($insertsCount > 0) {
    if ($successfulInserts == $insertsCount) {
        echo ("All new files inserted successfully<br>");
    } else {
    echo $successfulInserts." of ".$insertsCount." files inserted<br>";
    }
}

$updates = 0;
$successfulUpdates = 0;
$updateFiles = glob("./updates/*.txt");
$updatesCount = count($updateFiles);

for ($i = 0; $i < $updatesCount; ++$i ) {

    $updates++;
    $filenm = $updateFiles[$i];
    $update = "UPDATE days SET markup=:markup  WHERE year=:year AND month_num=:month_num AND day=:day";
    $stmt = $conn->prepare($update);
    $stmt->bindParam(":year", $year);
    $stmt->bindParam(":month_num", $month_num);
    $stmt->bindParam(":day", $day);
    $stmt->bindParam(":markup", $markup);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_WARNING);

    $file = fopen($filenm, "r");
    $markup = fread($file, filesize($filenm));
    $pm = preg_match('/\d{2}\/\d{2}\/\d{4}/', $markup, $res);
    $keys = explode("/", $res[0]);
    $year = $keys[2];
    $day = $keys[1];
    $month_num = $keys[0];
    $markup = esc($markup);
    if ($stmt->execute()) {
        $successfulUpdates++;
        fwrite($export, "UPDATE `days` SET `markup`='".$markup_esc."' WHERE `year`=".$year." AND `month_num`=".$month_num." AND `day`=".$day.";\n");
        fclose($file);
        unlink($filenm);
    } else { 
        echo "Insert failed for ".$res[0].". See php.error.log<br?";
        fclose($file);
    }

}

if ($updatesCount > 0) {
    if ($successfulUpdates == $updatesCount) {
        echo ("All changed files updated successfully<br>");
    } else {
    echo $successfulUpdates." of ".$updatesCount." files updated<br>";
    }
}
?>

Import file written to: <?php echo $export_name; ?><br>
</div>
</div>
</body>
</html>

<?php
fclose($export);
ob_end_flush();
$stmt = null;
$conn = null;
?>
