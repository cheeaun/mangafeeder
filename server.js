var http = require('http'),
	director = require('director'),
	request = require('request'),
	cheerio = require('cheerio'),
	url = require('url'),
	fs = require('fs'),
	RSS = require('rss'),
	moment = require('moment');

var ROOT_DOMAIN = 'http://www.mangareader.net';
var UPDATES = [];
var update = function(){
	console.log('Updating manga updates.');
	var _UPDATES = [];

	request(ROOT_DOMAIN + '/latest', function(error, response, body){
		if (error || response.statusCode != 200){
			console.error(error);
			setTimeout(update, 5*60*1000); // 5 minutes
			return;
		}
		var $ = cheerio.load(body);
		var $rows = $('#latestchapters .updates>tr');
		$rows.each(function(i, elem){
			var el = $(elem);

			// 1. Grab all relevant elements
			var $status = el.find('.manga_close, .manga_open'),
				$manga = el.find('a.chapter'),
				$new = el.find('.new'),
				$hot = el.find('.hot'),
				$chapters = el.find('a.chaptersrec'),
				$date = el.find('.c1');

			// 2. Extract data from elements
			var completed = $status.hasClass('manga_close'),
				mangaTitle = $manga.text().trim(),
				slug = $manga.attr('href').replace(/^\//, ''),
				mangaURL = ROOT_DOMAIN + '/' + slug,
				_new = !!$new.length,
				hot = !!$hot.length,
				chapters = (function(){
					var arr = [];
					$chapters.each(function(){
						var $chapter = $(this);
						arr.push({
							title: $chapter.text().trim(),
							url: ROOT_DOMAIN + $chapter.attr('href')
						});
					});
					return arr;
				})(),
				date = $date.text().trim();

			var slugMatch = slug.match(/\/([^\.\/]+)\.html/i);
			if (slugMatch) slug = slugMatch[1];

			_UPDATES.push({
				completed: completed,
				title: mangaTitle,
				slug: slug,
				url: mangaURL,
				image_url: 'http://s1.mangareader.net/cover/' + slug + '/' + slug + '-l0.jpg',
				'new': _new,
				hot: hot,
				chapters: chapters,
				date: date
			});
		});

		UPDATES = _UPDATES;
		console.log('Updates updated.');
	});

	setTimeout(update, 30*60*1000); // 30 minutes
};
update();

var router = new director.http.Router().configure({
	strict: false
});

router.get('/', function(){
	this.res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
	var r = this;
	fs.readFile('index.html', function(e, content){
		r.res.end(content);
	});
});

router.get('/search', function(q){
	var url = ROOT_DOMAIN + '/actions' + this.req.url;
	var r = request(url);
	r.on('error', function(err){
		console.error(err);
	});
	r.pipe(this.res);
});

router.get(/\/latest\.(json|rss)/i, function(format, queries){
	var reqURL = this.req.url;
	var query = url.parse(reqURL, true).query;
	var filter = query.filter;
	var limit = parseInt(query.limit, 10) || 20;

	var filters = filter ? filter.split(',').map(function(f){
		return f.trim().replace(/\s+/, '-');
	}) : [];
	var _UPDATES = filter ? UPDATES.filter(function(manga){
		for (var i=0, l=filters.length; i<l; i++){
			var f = filters[i];
			if (manga.slug.indexOf(f) != -1){
				return true;
			}
		}
		return false;
	}) : UPDATES;
	_UPDATES = _UPDATES.slice(0, limit);

	if (format.toLowerCase() == 'rss'){
		var feed = new RSS({
			title: 'Mangafeeder',
			description: 'Latest manga chapters from Mangareader.net',
			site_url: ROOT_DOMAIN,
			feed_url: reqURL
		});

		for (var i=0, l=_UPDATES.length; i<l; i++){
			var manga = _UPDATES[i];
			var date = manga.date;
			if (/today/i.test(date)){
				date = moment();
			} else if (/yesterday/i.test(date)){
				date = moment().subtract('days', 1);
			} else {
				date = moment(date);
			}
			var chapters = manga.chapters;

			var item = {
				description: (function(){
						var html = '<a href="' + manga.url + '"><img src="' + manga.image_url +  '" alt=""></a><br>';
						html += chapters.map(function(chapter){
							return '<a href="' + chapter.url + '">' + chapter.title + '</a>';
						}).join('<br>');
						return html;
					})(),
				guid: (function(){
						return chapters.map(function(chapter){
							return chapter.url;
						}).join(',');
					})(),
				date: date.toDate()
			};

			item.title = manga.title;
			item.url = manga.url;
			var chaptersLen = chapters.length;
			if (chaptersLen > 1){
				var chaptersNum = chapters.map(function(chapter){
					return chapter.title.match(/\d+$/);
				}).filter(function(num){
					return num !== null;
				}).reverse();
				if (chaptersNum.length){
					item.title += ' ' + chaptersNum.join(', ');
				}
			} else if (chaptersLen == 1 && !manga.new){
				var firstChapter = chapters[0];
				item.title = firstChapter.title;
				item.url = firstChapter.url;
			}
			if (manga.new) item.title += ' [NEW]';
			if (manga.hot) item.title += ' [HOT]';

			feed.item(item);
		}

		this.res.writeHead(200, {
			'Content-Type': 'text/xml; charset=UTF-8'
		});
		this.res.end(feed.xml());
	} else {
		var content = JSON.stringify(_UPDATES);
		this.res.writeHead(200, {
			'Content-Type': 'application/json; charset=UTF-8',
			'Content-Length': content.length
		});
		this.res.end(content);
	}
});

var server = http.createServer(function(req, res){
	router.dispatch(req, res, function(err){
		if (err){
			console.error(err);
			res.writeHead(404);
			res.end(JSON.stringify(err));
		}
	});
});

server.listen(nconf.get('app_port') || 80);