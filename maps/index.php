<?php
$folder = __DIR__; // Current folder
$files = array_diff(scandir($folder), array('.', '..', 'index.php', 'filelist.txt')); // Exclude script & output

// Export to filelist.txt
file_put_contents('filelist.txt', implode(PHP_EOL, $files));
?>

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Folder File Browser</title>
<style>
  body { font-family: Arial, sans-serif; background: #151e28; color: #dde; margin: 0; padding: 20px; }
  h1 { color: #4da3ff; }
  input[type="text"] { padding: 5px; width: 300px; margin-bottom: 20px; border: 1px solid #283445; border-radius: 4px; background: #1f2a38; color: #dde; }
  ul { list-style: none; padding: 0; }
  li { margin-bottom: 5px; }
  a { color: #4da3ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .file-type { font-size: 0.9em; color: #90a4b8; margin-left: 8px; }
</style>
</head>
<body>

<h1>Folder File Browser</h1>
<p>File list has been exported to <strong>filelist.txt</strong></p>
<input type="text" id="searchInput" placeholder="Search files..." oninput="filterFiles()">

<ul id="fileList">
<?php foreach($files as $file): ?>
  <?php $ext = pathinfo($file, PATHINFO_EXTENSION); ?>
  <li>
    <a href="<?php echo htmlspecialchars($file); ?>" target="_blank"><?php echo htmlspecialchars($file); ?></a>
    <span class="file-type"><?php echo htmlspecialchars($ext); ?></span>
  </li>
<?php endforeach; ?>
</ul>

<script>
  function filterFiles() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const items = document.querySelectorAll('#fileList li');
    items.forEach(li => {
      const text = li.textContent.toLowerCase();
      li.style.display = text.includes(query) ? '' : 'none';
    });
  }
</script>

</body>
</html>
