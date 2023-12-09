//move over code to update terms.db and set up to do so automatically
//handle zip uploads
//timer or file list display for bulk
//enable https
//change to kendewitt.com/leolinker instead of port
//make list of words not to link selectable in interface: films, music, terms, actors
//match case for movie table matches to avoid common words that happen to be movie titles
//add ability to preview and approve links before copying
//Some terms are doubled. Need to ask which ones are correct.

const express = require('express');
const multer = require('multer');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const app = express();
const archiver = require('archiver');
const port = 3000;
app.use('/public', express.static(__dirname + '/public'));
const { unnecessary_links, unnecessary_urls } = require(__dirname + '/public/common-functions.js');
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// Array to store terms from terms.db
let termsArray = [];

const removeUnnecessaryTermsFromLinks = (links, unnecessaryLinks, unnecessaryUrls) => {
  return links.filter(subarray =>
    !unnecessaryLinks.includes(subarray[0]) &&
    !unnecessaryUrls.includes(subarray[1])
  );
};

// Open SQLite database
const db = new sqlite3.Database('public/terms.db', sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(err.message);
    return;
  }
  console.log('Connected to the terms.db database.');
});

// Load terms from the database at startup
db.all("SELECT term, url FROM terms", [], (err, rows) => {
  if (err) {
    console.error("Error fetching terms from the database", err);
    return;
  }

  termsArray = rows.map(row => [row.term, row.url]);// Convert rows to array of subarrays

  const sortTermsByLength = (terms) => {
    return terms.sort((a, b) => b[0].length - a[0].length);
  };// Sort the terms by length

  termsArray = sortTermsByLength(termsArray);
  termsArray = removeUnnecessaryTermsFromLinks(termsArray, unnecessary_links, unnecessary_urls);

  db.close(() => {
    console.log('Database connection closed.');
  });

});


// Endpoint to get termsArray
app.get('/api/terms', (req, res) => {
  res.json(termsArray);
});


// Variable to store the filename of the file currently being processed
let currentFileName;

function generateFileID() {
  return Math.floor(Math.random() * 1000000000);
};

let fileID = generateFileID();

// Middleware to generate a fileID for each upload request
function generateFileIDMiddleware(req, res, next) {
  req.fileID = generateFileID();
  next();
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const fileID = req.fileID;
    cb(null, `${path.basename(file.originalname, ext)}-${fileID}${ext}`);
  }
});

//this sets the storage location and size
const upload = multer({
  storage: storage,
  limits: { fileSize: 10000000 } // 10MB file size limit, adjust as needed
});

// Serve an HTML file for file upload
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/bulk-upload', (req, res) => {
  res.sendFile(__dirname + '/bulk-upload.html');
});

app.post('/upload', generateFileIDMiddleware, upload.array('files', 500), function (req, res, next) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  // Create a ZIP file
  const zipFileName = `processed_files-${req.fileID}.zip`;
  const zipFilePath = path.join(__dirname, 'ready_to_download', zipFileName);
  const output = fs.createWriteStream(zipFilePath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Compression level
  });

  archive.pipe(output);

  req.files.forEach(inputFile => {
    let inputFileName = inputFile.filename;

    // Remove the fileID from the filename
    let originalFileName = inputFileName.split('-');
    originalFileName.pop(); // Remove the last element (fileID)
    originalFileName = originalFileName.join('-') + path.extname(inputFileName); // Reconstruct the filename

    // Process the file
    const originalText = loadFileIntoString(`uploads/${inputFileName}`, fs);
    const textWithTableRemoved = extractAndRemoveTable(originalText);
    const modifiedText = createLinks(textWithTableRemoved);
    const textWithMarkdownLinks = convertHTMLLinksToMarkdownLinks(modifiedText);
    tableHolder = createTableLinks(tableHolder, termsArray);
    const completeText = putTableBack(textWithMarkdownLinks);

    // Add the processed content to the archive with the original filename
    archive.append(completeText, { name: originalFileName });
  });

  // Finalize the archive
  archive.finalize();

  output.on('close', function() {
    console.log(archive.pointer() + ' total bytes');
    console.log('Archiver has been finalized and the output file descriptor has closed.');
    currentFileName = zipFileName;
    // Redirect to download the ZIP file
    res.redirect(`/download?file=${zipFileName}`);
  });

  // Handle archiving errors
  archive.on('error', function(err){
    res.status(500).send(`Error creating ZIP file: ${err.message}`);
  });
});






const loadFileIntoString = (filePath, fs) => {
  try {
    // Read the file contents into a string
    const data = fs.readFileSync(filePath, 'utf8');
    return data;
  } catch (err) {
    // Handle any errors that occur during file reading
    console.error("Error reading file:", err);
    return null;
  }
};






let tableHolder

const extractAndRemoveTable = (string) => {
  // Regular expression to match the HTML table and its contents
  const tableRegex = /<table[\s\S]*?<\/table>/i;

  // Find the table in the string
  const foundTable = string.match(tableRegex);

  // If a table is found, remove it from the string
  if (foundTable) {
    tableHolder = foundTable[0];
    string = string.replace(tableRegex, '%%table_goes_here%%');
  } else {
    // Set tableHolder to null if no table is found
    tableHolder = null;
  }

  return string;
};


const markSecondTD = (tableString) => {
  const rowRegex = /<tr>[\s\S]*?<\/tr>/g; // Regular expression to find each table row

  return tableString.replace(rowRegex, (row) => {
    // Find all <td> elements in the row
    let tdElements = row.match(/<td>[\s\S]*?<\/td>/g);
    // Check if there are at least 2 <td> elements
    if (tdElements && tdElements.length >= 2) {
      // Mark the second <td> element
      tdElements[1] = tdElements[1].replace(/<td>([\s\S]*?)<\/td>/, '<td>%%$1%%</td>');

      // Reconstruct the row with the modified second <td>
      return row.replace(/<td>[\s\S]*?<\/td>/g, () => tdElements.shift());
    }
    return row;
  });
};



function putTableBack(inputString) {
  return inputString.replace('%%table_goes_here%%', tableHolder);
}


const createLinks = (text) => {
  let modifiedText = text;
  const markdownLinks = [];
  const markdownPlaceholder = "%%MARKDOWN_LINK%%";
  const escapeRegExp = (string) => {
    return string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');
  };

  // Temporarily remove markdown links
  modifiedText = modifiedText.replace(/\[(.*?)\]\((.*?)\)/g, (match) => {
    markdownLinks.push(match);
    return markdownPlaceholder;
  });

  // Perform keyword replacements for the first instance
  let index = 0;
  const matchesArray = [];

  termsArray.forEach(([keyword, url]) => {
    const escapedKeyword = escapeRegExp(keyword);
    const regex = new RegExp(`(?<=\\s|^)${escapedKeyword.replace(/ /g, '\\s')}(?=[.,;:\\s]|$)`, 'i');

    modifiedText = modifiedText.replace(regex, () => {
      matchesArray.push({ keyword, url });
      return `[[${index++}]]`;
    });
  });

  matchesArray.forEach(({ keyword, url }, i) => {
    const replaceRegex = new RegExp(`\\[\\[${i}\\]\\]`, 'g');
    modifiedText = modifiedText.replace(replaceRegex, `<a href="${url}" target="_blank">${keyword}</a>`);
  });

  // Put markdown links back
  let markdownIndex = 0;
  modifiedText = modifiedText.replace(new RegExp(markdownPlaceholder, 'g'), () => {
    return markdownLinks[markdownIndex++];
  });

  return modifiedText;
};




const createTableLinks = (tableString, termsArray) => {
  if (!tableString) {
    console.log('createTableLinks was passed a null tableString');
    return ''; // Return an appropriate default value
  }

  let modifiedTable = markSecondTD(tableString);

  termsArray.forEach(([term, url]) => {
    // Escape special characters for regular expression
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Create a regular expression to find the term, ensuring it's exactly within <td> and </td>
    const regex = new RegExp(`(<td>%%${escapedTerm}%%</td>)`, 'g');

    // Replace the term with the anchor tag, preserving the <td> tags
    modifiedTable = modifiedTable.replace(regex, `<td><a href="${url}">${term}</a></td>`);
  });

  modifiedTable = modifiedTable.replace(/%%/g, '');

  return modifiedTable;
};


function convertHTMLLinksToMarkdownLinks(htmlString) {
  // Regular expression to find HTML a tags and capture their text and href attributes

  const anchorRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gis;

  // Replace HTML a tags with Markdown links
  return htmlString.replace(anchorRegex, (match, href, text) => `[${text}](${href})`);
}

function saveToDownloads(completeText, fileName) {
  const folderPath = path.join(__dirname, 'ready_to_download');

  // Check if the folder exists, if not create it
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath);
  }

  // Add unique request number after filename
  const filePath = path.join(folderPath, `${fileName}.md`);

  // Write the file
  fs.writeFileSync(filePath, completeText);  // Changed to writeFileSync for simplicity
  return filePath; // Return the file path
}

app.get('/download', (req, res) => {
  res.sendFile(path.join(__dirname, 'download.html'));
});

app.get('/single-file', (req, res) => {
  res.sendFile(path.join(__dirname, 'single-file.html'));
});


app.get('/downloadFiles', (req, res) => {
  if (!currentFileName) {
    return res.status(404).send("No file available for download.");
  }
























  const filePath = path.join(__dirname, 'ready_to_download', currentFileName);
  res.download(filePath, (err) => {
    if (err) {
      console.error(err);
      res.status(500).send("Error downloading the file.");
    }
  });
});












app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
  });










  const deleteOldFilesInDirectory = (directory) => {
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error(`Error reading directory: ${directory}`, err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(directory, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error("Error getting file stats:", err);
          return;
        }

        if (Date.now() - stats.mtime.getTime() > 5 * 60 * 1000) { // 5 minutes in milliseconds
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error("Error deleting file:", err);
            } else {
              console.log(`Deleted old file: ${file} from ${directory}`);
            }
          });
        }
      });
    });
  });
};

const deleteOldFiles = () => {
  const uploadsDir = path.join(__dirname, 'uploads');
  const readyToDownloadDir = path.join(__dirname, 'ready_to_download');

  deleteOldFilesInDirectory(uploadsDir);
  deleteOldFilesInDirectory(readyToDownloadDir);
};



setInterval(deleteOldFiles, 15 * 60 * 1000);
